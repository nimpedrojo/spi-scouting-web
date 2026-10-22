// One-off, operator-reviewed schema release. Never called by the SSH deploy key.
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { userInfo } = require('node:os');
const path = require('node:path');

const ROOT = '/var/www/spi-scouting-deploy';
const HELPER = '/usr/local/libexec/spi-scouting-deploy.cjs';
const REPO = 'https://github.com/nimpedrojo/spi-scouting-web.git';
const SHA = /^[a-f0-9]{40}$/;
const PINS = Object.freeze({
  'sql/access-requests.sql': '276a55698f2b1d940160c5e3ca06a13666c7f264f5609a6f46935df33da78c09',
  'src/initDb.js': '9623ba9df0df214dce1db718bbf3181e8c844fec3b3d84eb492e2017d0587f4a',
  'src/models/accessRequestModel.js': '5d52765baf8f67ff7d3da0025c0a809953efc198799aefe14815affe00c56704',
});
const digest = data => createHash('sha256').update(data).digest('hex');

function parseArgs(args) {
  const [mode, target, previous, confirmation] = args;
  if (!['--prepare', '--activate'].includes(mode) || !SHA.test(target || '') || !SHA.test(previous || '') || target === previous
    || (mode === '--prepare' && args.length !== 3)
    || (mode === '--activate' && (args.length !== 4 || confirmation !== '--confirm-stop-soccer-report'))) {
    throw new Error('Usage: --prepare TARGET_SHA EXPECTED_CURRENT_SHA | --activate TARGET_SHA EXPECTED_CURRENT_SHA --confirm-stop-soccer-report');
  }
  return { mode, target, previous };
}

function assertSchemaDiff(changed, schemaChanges) {
  const schema = schemaChanges(changed);
  if (schema.length !== 3 || schema.some(file => !Object.hasOwn(PINS, file))) {
    throw new Error('Only the three reviewed access-request schema files are allowed');
  }
}

function assertPins(contents) {
  for (const [file, hash] of Object.entries(PINS)) {
    if (!contents[file] || digest(contents[file]) !== hash) throw new Error(`Reviewed file differs: ${file}`);
  }
}

async function backupAndApply(deployment) {
  await deployment.backup();
  await deployment.applySchema(); // No DDL before a successful consistent snapshot.
}

function createReleaseClass(helpers, options) {
  return class AccessRequestsRelease extends helpers.ProductionDeployment {
    async connection() {
      const mysql = require(`${this.previous}/node_modules/mysql2/promise`);
      return mysql.createConnection({
        host: this.db.DB_HOST, port: this.db.DB_PORT, user: this.db.DB_USER,
        password: this.db.DB_PASSWORD || '', database: 'player_iq_db', connectTimeout: 10000,
      });
    }

    async inspectDatabase() {
      const connection = await this.connection();
      try {
        const [[column]] = await connection.query("SELECT DATA_TYPE, COLUMN_TYPE, COLUMN_KEY, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'id'");
        const [[table]] = await connection.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'");
        const [[existing]] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_requests'");
        if (!column || column.DATA_TYPE !== 'int' || column.COLUMN_TYPE.includes('unsigned') || column.COLUMN_KEY !== 'PRI'
          || column.IS_NULLABLE !== 'NO' || table?.ENGINE !== 'InnoDB') throw new Error('Unexpected users primary key/engine; review the foreign key');
        if (Number(existing.total) !== 0) throw new Error('access_requests already exists; inspect before attempting a new schema release');
      } finally { await connection.end(); }
    }

    async validateContext() {
      if (process.getuid() === 0 || userInfo().username !== 'ubuntu') throw new Error('Run as ubuntu, never root');
      if (process.version !== 'v22.23.3' || await this.run('/usr/bin/npm', ['--version']) !== '10.9.9') throw new Error('Unexpected runtime');
      if (await fs.realpath(ROOT) !== ROOT) throw new Error('Unexpected deployment root');
      this.previous = await fs.realpath(`${ROOT}/current`);
      this.previousSha = path.basename(this.previous);
      if (this.previous !== `${ROOT}/releases/${options.previous}`) throw new Error('Current release changed; stop and reassess');
      const daemon = (await fs.readFile('/home/ubuntu/.pm2/pm2.pid', 'utf8')).trim();
      if (!/^\d+$/.test(daemon) || (await fs.stat(`/proc/${daemon}`)).uid !== process.getuid()
        || !(await fs.readFile(`/proc/${daemon}/cmdline`, 'utf8')).includes('/home/ubuntu/.pm2')) throw new Error('Expected running PM2 daemon missing');
      for (const relative of ['.env', 'uploads', 'templates/report_template.xlsm']) {
        const file = `${ROOT}/shared/${relative}`;
        if (await fs.realpath(file) !== file) throw new Error('Unexpected shared-state symlink');
      }
      this.db = require(`${this.previous}/node_modules/dotenv`).parse(await fs.readFile(`${ROOT}/shared/.env`));
      if (this.db.DB_NAME !== 'player_iq_db' || !['localhost', '127.0.0.1'].includes(this.db.DB_HOST)
        || !this.db.DB_PORT || !this.db.DB_USER || !this.db.SESSION_SECRET || this.db.NODE_ENV !== 'production') throw new Error('Unexpected environment contract');
      await this.latest();
      const apps = await this.apps();
      const targets = apps.filter(p => p.name === 'soccer-report');
      if (targets.length !== 1 || targets[0].pm2_env.status !== 'online' || targets[0].pm2_env.pm_cwd !== this.previous
        || targets[0].pm2_env.pm_exec_path !== `${this.previous}/src/server.js`) throw new Error('Unexpected active process');
      const others = helpers.otherApps(apps);
      if (this.preparedOthers && JSON.stringify(this.preparedOthers) !== JSON.stringify(others)) throw new Error('Other applications changed during preparation');
      this.preparedOthers = others;
      await this.inspectDatabase();
    }

    async verifyCandidate(directory) {
      if (await this.run('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: directory }) !== this.sha) throw new Error('Wrong candidate SHA');
      const changed = (await this.run('/usr/bin/git', ['diff', '--name-only', this.previousSha, this.sha], { cwd: directory })).split('\n');
      assertSchemaDiff(changed, helpers.schemaChanges);
      const contents = {};
      for (const file of Object.keys(PINS)) contents[file] = await fs.readFile(`${directory}/${file}`);
      assertPins(contents);
      // The helper installed outside the incoming checkout must remain unchanged.
      if (digest(await fs.readFile(HELPER)) !== digest(await fs.readFile(`${directory}/scripts/deploy-production.cjs`))) throw new Error('Incoming helper differs from installed helper');
      const edits = await this.run('/usr/bin/git', ['diff', '--name-status', 'HEAD'], { cwd: directory });
      if (edits && edits.split('\n').some(line => !line.startsWith('D\tsrc/public/uploads/'))) throw new Error('Candidate tracked files have local edits');
    }

    async prepare() {
      await this.validateContext();
      if (options.mode === '--prepare') {
        try { await fs.lstat(this.release); throw new Error('Candidate already exists; inspect before retrying'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const staging = await fs.mkdtemp(`${ROOT}/releases/.access-request-${this.sha}-`);
        await this.run('/usr/bin/git', ['init', staging]);
        await this.run('/usr/bin/git', ['remote', 'add', 'origin', REPO], { cwd: staging });
        await this.run('/usr/bin/git', ['fetch', '--depth=1', 'origin', this.sha, this.previousSha], { cwd: staging });
        await this.run('/usr/bin/git', ['checkout', '--detach', this.sha], { cwd: staging });
        await this.verifyCandidate(staging);
        await this.run('/usr/bin/npm', ['ci', '--omit=dev', '--no-fund'], { cwd: staging, timeout: 600000, quiet: false });
        await this.verifyCandidate(staging);
        try { await fs.lstat(`${staging}/.env`); throw new Error('Candidate must not contain .env before linking'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await fs.rename(`${staging}/src/public/uploads`, `${staging}/repository-uploads`);
        await fs.symlink(`${ROOT}/shared/uploads`, `${staging}/src/public/uploads`);
        await fs.symlink(`${ROOT}/shared/.env`, `${staging}/.env`);
        await fs.rename(staging, this.release);
      }
      if (await fs.realpath(this.release) !== this.release) throw new Error('Unexpected candidate path');
      await this.verifyCandidate(this.release);
      for (const [relative, target] of [['.env', '.env'], ['src/public/uploads', 'uploads']]) {
        if (!(await fs.lstat(`${this.release}/${relative}`)).isSymbolicLink()
          || await fs.realpath(`${this.release}/${relative}`) !== `${ROOT}/shared/${target}`) throw new Error('Candidate shared link differs');
      }
    }

    async preflight() {
      if (JSON.stringify(helpers.otherApps(await this.apps())) !== JSON.stringify(this.preparedOthers)) throw new Error('Other applications changed during preparation');
      await this.validateContext();
      process.env.SPI_RELEASE_PATH = this.release;
      await super.preflight(); // Existing PM2 declaration, daemon and dump checks.
      if (JSON.stringify(this.others) !== JSON.stringify(this.preparedOthers)) throw new Error('Other applications changed before activation');
    }

    backup() {
      return backupAndApply({ backup: () => super.backup(), applySchema: () => this.applySchema() });
    }

    async verify() {
      await super.verify();
      const form = await this.run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--max-time', '10', 'https://soccer-report.processiq.es/request-access']);
      if (!form.includes('action="/request-access"') || !form.includes('name="_csrf"')) throw new Error('Access request form not available');
      for (const [url, location] of [['/register', '/request-access'], ['/admin/access-requests', '/login']]) {
        const response = await this.run('/usr/bin/curl', ['--silent', '--show-error', '--max-time', '10', '--output', '/dev/null', '--write-out', '%{http_code} %{redirect_url}', `https://soccer-report.processiq.es${url}`]);
        if (response !== `302 https://soccer-report.processiq.es${location}`) throw new Error('Unexpected registration/admin access response');
      }
    }

    async applySchema() {
      this.controller.signal.throwIfAborted();
      await this.inspectDatabase();
      const contents = {};
      for (const file of Object.keys(PINS)) contents[file] = await fs.readFile(`${this.release}/${file}`);
      assertPins(contents);
      const connection = await this.connection();
      try {
        this.controller.signal.throwIfAborted();
        await connection.query({ sql: 'SET SESSION lock_wait_timeout = 15', timeout: 10000 });
        await connection.query({ sql: contents['sql/access-requests.sql'].toString('utf8'), timeout: 30000 });
        this.controller.signal.throwIfAborted();
        const [[result]] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_requests'");
        if (Number(result.total) !== 11) throw new Error('Unexpected access request column count');
      } finally { await connection.end(); }
    }
  };
}

async function main() {
  process.umask(0o077);
  const options = parseArgs(process.argv.slice(2));
  // Must be started under the SAME flock as the installed SSH wrapper (see runbook).
  if (process.env.SPI_MANUAL_RELEASE_LOCK !== 'access-requests') throw new Error('Use the reviewed flock invocation from the runbook');
  const helpers = require(HELPER);
  const Release = createReleaseClass(helpers, options);
  const deployment = new Release(options.target);
  process.env.SPI_RELEASE_PATH = deployment.release;
  const abort = () => deployment.controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  const deadline = setTimeout(abort, 12 * 60 * 1000); deadline.unref();
  process.stdout.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  process.stderr.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  try {
    if (options.mode === '--prepare') {
      await deployment.prepare();
      await deployment.preflight();
      console.log(`Candidate prepared, no process stopped and no DDL executed: ${deployment.release}`);
      console.log(`Preflight snapshot directory (not a DB backup): ${deployment.backupDir}`);
    } else {
      await helpers.executeDeployment(deployment);
      console.log(`Schema release verified and PM2 saved: ${options.target}`);
      console.log(`Private backup: ${deployment.backupDir}`);
    }
  } finally { clearTimeout(deadline); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, assertSchemaDiff, assertPins, backupAndApply, createReleaseClass, PINS };
