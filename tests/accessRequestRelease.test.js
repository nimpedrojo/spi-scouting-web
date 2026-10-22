const fs = require('node:fs');
const path = require('node:path');
const helpers = require('../scripts/deploy-production.cjs');
const { parseArgs, assertSchemaDiff, assertPins, backupAndApply, createReleaseClass, PINS } = require('../scripts/release-access-requests.cjs');

const { assertRehearsalConfig } = require('../scripts/rehearse-access-requests-schema.cjs');

const target = 'a'.repeat(40);
const previous = 'b'.repeat(40);

describe('Operator-only access request release', () => {
  test('prepare and activation have explicit, distinct command contracts', () => {
    expect(parseArgs(['--prepare', target, previous])).toEqual({ mode: '--prepare', target, previous });
    expect(parseArgs(['--activate', target, previous, '--confirm-stop-soccer-report']).mode).toBe('--activate');
  });
  test.each([
    [], ['--activate', target, previous], ['--prepare', target, target], ['--prepare', 'master', previous],
    ['--prepare', target, previous, 'extra'], ['--activate', target, previous, '--force'],
  ].map(args => [args]))('rejects accidental or ambiguous invocation (%p)', args => {
    expect(() => parseArgs(args)).toThrow();
  });
  test('allows only this exact schema diff, preserving the regular helper guard', () => {
    const files = Object.keys(PINS);
    expect(() => assertSchemaDiff([...files, 'src/views/auth/login.ejs'], helpers.schemaChanges)).not.toThrow();
    expect(helpers.schemaChanges(files)).toEqual(files);
    for (const changed of [files.slice(1), [...files, 'src/db.js'], [...files, 'src/models/userModel.js'], [...files, 'sql/destructive.sql']]) {
      expect(() => assertSchemaDiff(changed, helpers.schemaChanges)).toThrow();
    }
  });
  test('pins the exact reviewed DDL, model and initializer and rejects any edit', () => {
    const contents = Object.fromEntries(Object.keys(PINS).map(file => [file, fs.readFileSync(path.join(__dirname, '..', file))]));
    expect(() => assertPins(contents)).not.toThrow();
    for (const file of Object.keys(PINS)) {
      expect(() => assertPins({ ...contents, [file]: Buffer.concat([contents[file], Buffer.from('\n-- changed')]) })).toThrow();
      expect(() => assertPins({ ...contents, [file]: undefined })).toThrow();
    }
  });
  test('DDL happens strictly after a successful backup', async () => {
    const events = [];
    await backupAndApply({ backup: async () => events.push('backup'), applySchema: async () => events.push('DDL') });
    expect(events).toEqual(['backup', 'DDL']);
    const applySchema = jest.fn();
    await expect(backupAndApply({ backup: async () => { throw new Error('backup failed'); }, applySchema })).rejects.toThrow('backup failed');
    expect(applySchema).not.toHaveBeenCalled();
  });
  test('DDL failure uses the installed lifecycle rollback before replacing the app', async () => {
    const events = [];
    const ops = Object.fromEntries(['prepare', 'preflight', 'stop', 'replace', 'verify', 'pointCurrent', 'save'].map(step => [step, jest.fn(async () => events.push(step))]));
    ops.backup = () => backupAndApply({ backup: async () => events.push('backup'), applySchema: async () => { throw new Error('DDL failed'); } });
    ops.rollback = jest.fn(async () => events.push('rollback'));
    await expect(helpers.executeDeployment(ops)).rejects.toThrow('DDL failed');
    expect(ops.replace).not.toHaveBeenCalled();
    expect(ops.rollback).toHaveBeenCalledWith({ replaced: false });
    expect(events).toEqual(['prepare', 'preflight', 'stop', 'backup', 'rollback']);
  });
  test('failed new-app verification recovers old code without any SQL restore callback', async () => {
    const ops = Object.fromEntries(['prepare', 'preflight', 'stop', 'replace', 'pointCurrent', 'save'].map(step => [step, jest.fn().mockResolvedValue()]));
    ops.backup = () => backupAndApply({ backup: jest.fn().mockResolvedValue(), applySchema: jest.fn().mockResolvedValue() });
    ops.verify = jest.fn().mockRejectedValue(new Error('new app unhealthy'));
    ops.rollback = jest.fn().mockResolvedValue();
    await expect(helpers.executeDeployment(ops)).rejects.toThrow('new app unhealthy');
    expect(ops.rollback).toHaveBeenCalledWith({ replaced: true });
    expect(ops.save).not.toHaveBeenCalled();
  });
  test('preflight refuses a changed other-app snapshot before preparing backup metadata', async () => {
    class Base { async preflight() { throw new Error('must not reach base'); } }
    const Release = createReleaseClass({ ProductionDeployment: Base, otherApps: apps => apps }, {});
    const instance = new Release();
    instance.preparedOthers = ['old']; instance.apps = async () => ['new'];
    instance.validateContext = jest.fn();
    await expect(instance.preflight()).rejects.toThrow('Other applications changed');
    expect(instance.validateContext).not.toHaveBeenCalled();
  });
  test('preflight also detects a change during the installed helper checks', async () => {
    class Base { async preflight() { this.others = ['new']; } }
    const Release = createReleaseClass({ ProductionDeployment: Base, otherApps: apps => apps }, {});
    const instance = new Release();
    instance.preparedOthers = ['old']; instance.apps = async () => ['old'];
    instance.validateContext = jest.fn().mockResolvedValue(); instance.release = '/fixture';
    const previousEnv = process.env.SPI_RELEASE_PATH;
    try { await expect(instance.preflight()).rejects.toThrow('Other applications changed'); }
    finally {
      if (previousEnv === undefined) delete process.env.SPI_RELEASE_PATH;
      else process.env.SPI_RELEASE_PATH = previousEnv;
    }
  });
  test('DDL application uses only pinned SQL, bounded lock wait and verifies its 11 columns', async () => {
    class Base { constructor() { this.controller = new AbortController(); } }
    const Release = createReleaseClass({ ProductionDeployment: Base }, { mode: '--activate' });
    const instance = new Release();
    instance.release = path.join(__dirname, '..');
    instance.inspectDatabase = jest.fn().mockResolvedValue();
    const connection = { query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([[{ total: 11 }]]), end: jest.fn().mockResolvedValue() };
    instance.connection = jest.fn().mockResolvedValue(connection);
    await instance.applySchema();
    expect(connection.query.mock.calls[0][0]).toEqual({ sql: 'SET SESSION lock_wait_timeout = 15', timeout: 10000 });
    expect(connection.query.mock.calls[1][0]).toEqual({ sql: fs.readFileSync(path.join(__dirname, '../sql/access-requests.sql'), 'utf8'), timeout: 30000 });
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
  test('abort before DDL does not inspect or mutate the database', async () => {
    class Base { constructor() { this.controller = new AbortController(); } }
    const Release = createReleaseClass({ ProductionDeployment: Base }, { mode: '--activate' });
    const instance = new Release();
    instance.inspectDatabase = jest.fn(); instance.connection = jest.fn();
    instance.controller.abort();
    await expect(instance.applySchema()).rejects.toThrow();
    expect(instance.inspectDatabase).not.toHaveBeenCalled();
    expect(instance.connection).not.toHaveBeenCalled();
  });
  test('manual backup override actually uses backup-before-DDL sequencing', async () => {
    const events = [];
    class Base { backup() { events.push('snapshot'); } }
    const Release = createReleaseClass({ ProductionDeployment: Base }, { mode: '--activate' });
    const instance = new Release();
    instance.applySchema = async () => events.push('schema');
    await instance.backup();
    expect(events).toEqual(['snapshot', 'schema']);
  });
  test('feature probes reject a missing form or an anonymously accessible queue', async () => {
    class Base { async verify() {} }
    const Release = createReleaseClass({ ProductionDeployment: Base }, { mode: '--activate' });
    const instance = new Release();
    instance.run = jest.fn().mockResolvedValue('old login');
    await expect(instance.verify()).rejects.toThrow('form');
    instance.run.mockReset().mockResolvedValueOnce('<form action="/request-access"><input name="_csrf"></form>')
      .mockResolvedValueOnce('302 https://soccer-report.processiq.es/request-access').mockResolvedValueOnce('200 ');
    await expect(instance.verify()).rejects.toThrow('response');
  });
});


describe('SQL rehearsal isolation', () => {
  const config = { DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'spi_rehearsal_fixture', DB_USER: 'spi_rehearsal' };
  test('accepts an explicitly restricted local clone', () => {
    expect(() => assertRehearsalConfig(config)).not.toThrow();
  });
  test.each([{ DB_NAME: 'player_iq_db' }, { DB_USER: 'root' }, { DB_HOST: 'db.example.test' }, { DB_PORT: '0' }, { DB_NAME: '' }])('rejects unsafe DB identity (%p)', override => {
    expect(() => assertRehearsalConfig({ ...config, ...override })).toThrow();
  });
});
