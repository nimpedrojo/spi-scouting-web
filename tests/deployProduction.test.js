const {
  parseCommand, releasePath, schemaChanges, otherApps, optionValue,
  executeDeployment, ProductionDeployment,
} = require('../scripts/deploy-production.cjs');

const sha = 'aeff9a19e8450fd8766c9d29a98131b10e18607f';

describe('Restricted deployment contract', () => {
  test('accepts only an exact full-SHA deploy command', () => {
    expect(parseCommand(`deploy ${sha}`)).toBe(sha);
    expect(releasePath(sha)).toBe(`/var/www/spi-scouting-deploy/releases/${sha}`);
  });
  test.each(['', 'bash', `deploy ${sha}; id`, `deploy ${sha}\n`, `deploy ${sha} extra`, 'deploy master', 'deploy ../../shared', 'deploy A'.repeat(40)])('rejects arbitrary SSH commands (%s)', command => {
    expect(() => parseCommand(command)).toThrow();
  });
  test('requires separate review for all schema initialization/model paths', () => {
    const files = ['src/db.js', 'src/initDb.js', 'src/models/userModel.js', 'src/core/models/clubModuleModel.js', 'src/modules/playerLoad/models/entry.js', 'sql/change.sql'];
    expect(schemaChanges(files)).toEqual(files);
    expect(schemaChanges(['src/views/test.ejs', 'src/controllers/teamController.js', 'docs/deployment/CI.md'])).toEqual([]);
  });
  test('other-app comparison includes PID and status but not environment secrets', () => {
    expect(otherApps([
      { name: 'soccer-report', pid: 2, pm2_env: { status: 'online' } },
      { name: 'other', pid: 1, pm2_env: { status: 'online', DB_PASSWORD: 'secret' } },
    ])).toEqual([{ name: 'other', pid: 1, status: 'online' }]);
  });
  test('quotes password option-file metacharacters without additional directives', () => {
    expect(optionValue('a"b\\c\n[other]\r')).toBe('"a\\"b\\\\c\\n[other]\\r"');
    expect(() => optionValue('bad\0value')).toThrow();
  });
});

function lifecycle(failure) {
  const events = [];
  const ops = {};
  for (const step of ['prepare', 'preflight', 'stop', 'backup', 'replace', 'verify', 'pointCurrent', 'save', 'verifySaved']) {
    ops[step] = jest.fn(async () => { events.push(step); if (failure === step) throw new Error(step); });
  }
  ops.rollback = jest.fn(async () => { events.push('rollback'); });
  return { ops, events };
}

describe('Deployment lifecycle recovery', () => {
  test('backs up while stopped and verifies before pointer/persistence changes', async () => {
    const { ops, events } = lifecycle();
    await executeDeployment(ops);
    expect(events).toEqual(['prepare', 'preflight', 'stop', 'backup', 'replace', 'verify', 'pointCurrent', 'save', 'verify']);
    expect(ops.rollback).not.toHaveBeenCalled();
  });
  test.each(['prepare', 'preflight'])('fails before stopping on %s errors', async step => {
    const { ops } = lifecycle(step);
    await expect(executeDeployment(ops)).rejects.toThrow(step);
    expect(ops.stop).not.toHaveBeenCalled();
    expect(ops.rollback).not.toHaveBeenCalled();
  });
  test.each(['stop', 'backup', 'replace', 'verify', 'pointCurrent', 'save'])('recovers a failed %s without a database restore', async step => {
    const { ops, events } = lifecycle(step);
    await expect(executeDeployment(ops)).rejects.toThrow(step);
    expect(events.at(-1)).toBe('rollback');
    expect(ops.rollback).toHaveBeenCalledWith({ replaced: !['stop', 'backup'].includes(step) });
    if (['stop', 'backup'].includes(step)) expect(ops.replace).not.toHaveBeenCalled();
  });
  test('reports rollback failure explicitly', async () => {
    const { ops } = lifecycle('replace');
    ops.rollback.mockRejectedValue(new Error('old release failed'));
    await expect(executeDeployment(ops)).rejects.toThrow('rollback verification failed');
  });
  test('repeated delivery verifies existing/saved release without downtime', async () => {
    const { ops, events } = lifecycle();
    ops.alreadyActive = true;
    await executeDeployment(ops);
    expect(events).toEqual(['prepare', 'verify', 'verifySaved']);
  });
});

describe('HTTP deployment verification', () => {
  test.each(['{"status":"ok"}\n200', '200'])('accepts the exact successful probe contract (%s)', async result => {
    const deployment = new ProductionDeployment(sha);
    deployment.run = jest.fn().mockResolvedValue(result);
    await expect(deployment.probe('http://localhost', result.startsWith('{'))).resolves.toBeUndefined();
  });
  test.each(['{"status":"ok"}\n201', '{"status":"ok"}\n302', 'wrong\n200', '302'])('rejects unexpected status/body (%s)', async result => {
    const deployment = new ProductionDeployment(sha);
    deployment.run = jest.fn().mockResolvedValue(result);
    await expect(deployment.probe('http://localhost', true)).rejects.toThrow();
  });
});
