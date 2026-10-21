// Reviewed, root-owned control-plane helper; never execute from incoming source.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { userInfo } = require('node:os');

const ROOT = '/var/www/spi-scouting-deploy';
const SHARED = `${ROOT}/shared`;
const PM2_HOME = '/home/ubuntu/.pm2';
const REPO = 'https://github.com/nimpedrojo/spi-scouting-web.git';
const SHA = /^[a-f0-9]{40}$/;

function parseCommand(command) {
  const match = /^deploy ([a-f0-9]{40})$/.exec(command || '');
  if (!match) throw new Error('Only deploy followed by a full commit SHA is accepted');
  return match[1];
}

function releasePath(sha) {
  if (!SHA.test(sha || '')) throw new Error('Invalid release SHA');
  return `${ROOT}/releases/${sha}`;
}

function schemaChanges(files) {
  return files.filter(file => /^(src\/(db\.js|initDb\.js|models\/|core\/models\/|modules\/[^/]+\/models\/)|sql\/)/.test(file));
}

function otherApps(apps) {
  return apps.filter(p => p.name !== 'soccer-report').map(p => ({
    name: p.name, pid: p.pid, status: p.pm2_env.status,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function optionValue(value) {
  if (String(value).includes('\0')) throw new Error('Invalid database option');
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

// Testable lifecycle: a failed backup/start/verification/save must not leave a
// stopped application or automatically restore SQL over new business writes.
async function executeDeployment(ops) {
  await ops.prepare();
  if (ops.alreadyActive) {
    await ops.verify();
    await ops.verifySaved();
    return;
  }
  await ops.preflight();
  let stopped = false;
  let replaced = false;
  try {
    stopped = true; // stop can partially succeed before its client returns an error
    await ops.stop();
    await ops.backup();
    replaced = true;
    await ops.replace();
    await ops.verify();
    await ops.pointCurrent();
    await ops.save();
    await ops.verify();
  } catch (error) {
    if (stopped) {
      try { await ops.rollback({ replaced }); }
      catch { throw new Error(`Deployment failed; rollback verification failed. Inspect the private backup. Original step: ${error.message}`); }
    }
    throw error;
  }
}

class ProductionDeployment {
  constructor(sha) {
    this.sha = sha;
    this.release = releasePath(sha);
    this.env = { PATH: '/usr/bin:/bin', HOME: '/home/ubuntu', USER: 'ubuntu', TZ: 'Europe/Madrid', PM2_HOME };
    this.controller = new AbortController();
  }

  async run(file, args, { cwd, output, timeout = 120000, quiet = true, recovery = false } = {}) {
    const handle = output ? await fs.open(output, 'wx', 0o600) : null;
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(file, args, {
          cwd, env: this.env, timeout,
          signal: recovery ? undefined : this.controller.signal,
          stdio: ['ignore', handle ? handle.fd : (quiet ? 'pipe' : 'inherit'), 'inherit'],
        });
        let stdout = '';
        if (child.stdout) child.stdout.on('data', data => { stdout += data; });
        let failure;
        let killTimer;
        const terminate = () => {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
          killTimer.unref();
        };
        const timer = setTimeout(terminate, timeout);
        timer.unref();
        child.on('error', () => { failure = new Error(`${path.basename(file)} failed or was interrupted`); terminate(); });
        child.on('close', code => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          if (failure) reject(failure);
          else if (code === 0) resolve(stdout.trim());
          else reject(new Error(`${path.basename(file)} exited ${code}`));
        });
      });
    } finally { await handle?.close(); }
  }

  pm(args, options) { return this.run('/usr/bin/pm2', args, options); }
  async apps(recovery = false) { return JSON.parse(await this.pm(['jlist'], { recovery })); }

  async latest() {
    const remote = await this.run('/usr/bin/git', ['ls-remote', REPO, 'refs/heads/master']);
    if (remote.split(/\s/)[0] !== this.sha) throw new Error('Stale commit: master has changed; no activation');
  }

  async prepare() {
    if (process.getuid() === 0 || userInfo().username !== 'ubuntu') throw new Error('Run as ubuntu, never root');
    if (process.version !== 'v22.23.3') throw new Error('Node runtime differs from validated version');
    if (await this.run('/usr/bin/npm', ['--version']) !== '10.9.9') throw new Error('npm runtime differs from validated version');
    await this.latest();
    if (await fs.realpath(ROOT) !== ROOT) throw new Error('Unexpected deployment root symlink');
    const daemonPid = (await fs.readFile(`${PM2_HOME}/pm2.pid`, 'utf8')).trim();
    if (!/^\d+$/.test(daemonPid) || (await fs.stat(`/proc/${daemonPid}`)).uid !== process.getuid()
      || !(await fs.readFile(`/proc/${daemonPid}/cmdline`, 'utf8')).includes(PM2_HOME)) throw new Error('Expected running PM2 daemon not found');
    this.previous = await fs.realpath(`${ROOT}/current`);
    const previousSha = path.basename(this.previous);
    if (releasePath(previousSha) !== this.previous || !(await fs.lstat(this.previous)).isDirectory()) throw new Error('Unexpected current release');
    this.previousSha = previousSha;
    if (previousSha === this.sha) {
      this.alreadyActive = true;
      this.others = otherApps(await this.apps());
      return;
    }
    for (const target of [`${SHARED}/.env`, `${SHARED}/uploads`, `${SHARED}/templates/report_template.xlsm`]) {
      if (await fs.realpath(target) !== target) throw new Error('Unexpected shared-state symlink');
    }
    // Parse using the already active, validated dependency; never source .env as shell.
    const dotenv = require(`${this.previous}/node_modules/dotenv`);
    this.db = dotenv.parse(await fs.readFile(`${SHARED}/.env`));
    if (this.db.DB_NAME !== 'player_iq_db' || !['localhost', '127.0.0.1'].includes(this.db.DB_HOST)
      || !this.db.DB_USER || !this.db.DB_PORT || !this.db.SESSION_SECRET) throw new Error('Unexpected production environment contract');

    // A failed/retried SHA is not overwritten in-place.
    const staging = await fs.mkdtemp(`${ROOT}/releases/.preparing-${this.sha}-`);
    await this.run('/usr/bin/git', ['init', staging]);
    await this.run('/usr/bin/git', ['remote', 'add', 'origin', REPO], { cwd: staging });
    await this.run('/usr/bin/git', ['fetch', '--depth=1', 'origin', this.sha, previousSha], { cwd: staging });
    await this.run('/usr/bin/git', ['checkout', '--detach', this.sha], { cwd: staging });
    const changed = (await this.run('/usr/bin/git', ['diff', '--name-only', previousSha, this.sha], { cwd: staging })).split('\n');
    if (schemaChanges(changed).length) throw new Error('Database initialization/model changes require a separately reviewed release');
    // The installed helper is reviewed separately; an incoming commit cannot update it.
    await this.run('/usr/bin/npm', ['ci', '--omit=dev', '--no-fund'], { cwd: staging, timeout: 600000, quiet: false });
    await fs.rename(`${staging}/src/public/uploads`, `${staging}/repository-uploads`);
    await fs.symlink(`${SHARED}/uploads`, `${staging}/src/public/uploads`);
    await fs.symlink(`${SHARED}/.env`, `${staging}/.env`);
    // Refuse to replace any existing SHA directory (active, failed, or retained).
    try { await fs.lstat(this.release); throw new Error('Release directory already exists; inspect before retrying'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(staging, this.release);
  }

  async preflight() {
    await this.latest();
    const config = require(`${this.release}/ecosystem.config.cjs`);
    // SPI_RELEASE_PATH is set by main before loading the declaration.
    if (config.apps?.length !== 1 || config.apps[0].name !== 'soccer-report'
      || config.apps[0].cwd !== this.release || config.apps[0].script !== `${this.release}/src/server.js`
      || config.apps[0].interpreter !== '/usr/bin/node' || String(config.apps[0].env?.PORT) !== '3002'
      || config.apps[0].env?.NODE_ENV !== 'production'
      || config.apps[0].env?.LOG_FILE_PATH !== '/var/www/soccer_report/shared/logs/app.log'
      || config.apps[0].env?.REPORT_TEMPLATE_PATH !== `${SHARED}/templates/report_template.xlsm`
      || Object.keys(config.apps[0].env).sort().join(',') !== 'HOST,LOG_FILE_PATH,NODE_ENV,PORT,REPORT_TEMPLATE_PATH'
      || config.apps[0].env?.HOST !== '127.0.0.1' || config.apps[0].instances !== 1
      || config.apps[0].watch !== false || config.apps[0].exec_mode !== 'fork') throw new Error('Unexpected PM2 declaration');
    const apps = await this.apps();
    const current = apps.find(p => p.name === 'soccer-report');
    if (!current || current.pm2_env.status !== 'online' || current.pm2_env.pm_cwd !== this.previous
      || current.pm2_env.pm_exec_path !== `${this.previous}/src/server.js`) throw new Error('Active target does not match current');
    if (apps.filter(p => p.name === 'soccer-report').length !== 1) throw new Error('Ambiguous target');
    this.others = otherApps(apps);
    await fs.mkdir(`${ROOT}/backups`, { mode: 0o700, recursive: true });
    if (await fs.realpath(`${ROOT}/backups`) !== `${ROOT}/backups`) throw new Error('Unexpected backups symlink');
    await fs.chmod(`${ROOT}/backups`, 0o700);
    this.backupDir = await fs.mkdtemp(`${ROOT}/backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${this.sha.slice(0, 12)}-`);
    console.log(`Private backup: ${this.backupDir}`);
    for (const name of ['dump.pm2', 'dump.pm2.bak']) {
      try { await fs.copyFile(`${PM2_HOME}/${name}`, `${this.backupDir}/${name}`); await fs.chmod(`${this.backupDir}/${name}`, 0o600); }
      catch (error) { if (name === 'dump.pm2' || error.code !== 'ENOENT') throw error; }
    }
    await fs.writeFile(`${this.backupDir}/release.json`, JSON.stringify({ previous: this.previousSha, candidate: this.sha, others: this.others }), { mode: 0o600 });
  }

  stop() { return this.pm(['stop', 'soccer-report']); }

  async backup() {
    const options = `${this.backupDir}/database-client.cnf`;
    const values = { host: this.db.DB_HOST, port: this.db.DB_PORT, user: this.db.DB_USER, password: this.db.DB_PASSWORD || '' };
    await fs.writeFile(options, '[client]\n' + Object.entries(values).map(([key, value]) => `${key}=${optionValue(value)}`).join('\n') + '\n', { mode: 0o600 });
    try {
      await this.run('/usr/bin/mariadb-dump', [`--defaults-extra-file=${options}`, '--single-transaction', '--quick', '--routines', '--events', '--triggers', '--hex-blob', 'player_iq_db'], { output: `${this.backupDir}/database.sql`, timeout: 300000 });
    } finally { await fs.unlink(options); }
    if (!(await fs.stat(`${this.backupDir}/database.sql`)).size) throw new Error('Empty database backup');
    await this.run('/usr/bin/tar', ['-czf', `${this.backupDir}/application-files.tar.gz`, '--exclude=./.git', '--exclude=./node_modules', '-C', this.previous, '.', '-C', ROOT, 'shared/.env', 'shared/uploads', 'shared/templates'], { timeout: 300000 });
    await this.run('/usr/bin/gzip', ['-t', `${this.backupDir}/application-files.tar.gz`]);
    const files = await fs.readdir(this.backupDir);
    const manifest = [];
    for (const file of files) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(`${this.backupDir}/${file}`)) hash.update(chunk);
      manifest.push(`${hash.digest('hex')}  ${file}`);
    }
    await fs.writeFile(`${this.backupDir}/SHA256SUMS`, manifest.join('\n') + '\n', { mode: 0o600 });
    await this.run('/usr/bin/sha256sum', ['-c', 'SHA256SUMS'], { cwd: this.backupDir });
  }

  async replace() {
    await this.pm(['delete', 'soccer-report']);
    this.env.SPI_RELEASE_PATH = this.release;
    await this.pm(['start', `${this.release}/ecosystem.config.cjs`, '--only', 'soccer-report']);
  }

  async probe(url, health, recovery = false) {
    await this.run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--max-time', '5', '--retry', '5', '--retry-connrefused', '--retry-delay', '1', '--retry-max-time', '30', '--write-out', '\n%{http_code}', ...(health ? [] : ['--output', '/dev/null']), url], { recovery }).then(body => {
      const separator = body.lastIndexOf('\n');
      const code = separator < 0 ? body : body.slice(separator + 1);
      if (code !== '200' || (health && body.slice(0, separator) !== '{"status":"ok"}')) throw new Error('Unexpected HTTP health/login response');
    });
  }

  async verifyTarget(release, recovery = false) {
    const apps = await this.apps(recovery);
    const target = apps.find(p => p.name === 'soccer-report');
    if (!target || target.pm2_env.status !== 'online' || target.pm2_env.pm_cwd !== release
      || target.pm2_env.pm_exec_path !== `${release}/src/server.js`
      || await fs.realpath(`/proc/${target.pid}/cwd`) !== release) throw new Error('Process release identity mismatch');
    if (JSON.stringify(otherApps(apps)) !== JSON.stringify(this.others)) throw new Error('Unrelated applications changed');
  }

  async verify() {
    await this.probe('http://127.0.0.1:3002/health', true);
    await this.probe('https://soccer-report.processiq.es/health', true);
    await this.probe('https://soccer-report.processiq.es/login', false);
    await this.verifyTarget(this.release);
  }

  async setPointer(release) {
    const temporary = `${ROOT}/.current-${process.pid}`;
    await fs.symlink(release, temporary);
    await fs.rename(temporary, `${ROOT}/current`);
  }
  pointCurrent() { return this.setPointer(this.release); }

  async save() {
    await this.verifyTarget(this.release);
    await this.pm(['save']);
    for (const name of ['dump.pm2', 'dump.pm2.bak']) {
      try { await fs.chmod(`${PM2_HOME}/${name}`, 0o600); }
      catch (error) { if (name === 'dump.pm2' || error.code !== 'ENOENT') throw error; }
    }
    await this.verifySaved();
  }

  async verifySaved() {
    const saved = JSON.parse(await fs.readFile(`${PM2_HOME}/dump.pm2`));
    if (!saved.some(p => p.name === 'soccer-report' && p.pm_cwd === this.release && p.pm_exec_path === `${this.release}/src/server.js`)) throw new Error('Saved target mismatch');
  }

  async rollback({ replaced }) {
    console.error('Recovering only soccer-report; no SQL restore.');
    if (replaced) {
      try { await this.pm(['delete', 'soccer-report'], { recovery: true }); } catch { /* target may be absent */ }
      this.env.SPI_RELEASE_PATH = this.previous;
      await this.pm(['start', `${this.previous}/ecosystem.config.cjs`, '--only', 'soccer-report'], { recovery: true });
    } else await this.pm(['restart', 'soccer-report'], { recovery: true });
    await this.setPointer(this.previous);
    for (const name of ['dump.pm2', 'dump.pm2.bak']) {
      try { await fs.copyFile(`${this.backupDir}/${name}`, `${PM2_HOME}/${name}`); await fs.chmod(`${PM2_HOME}/${name}`, 0o600); }
      catch (error) { if (name === 'dump.pm2' || error.code !== 'ENOENT') throw error; }
    }
    await this.probe('http://127.0.0.1:3002/health', true, true);
    await this.probe('https://soccer-report.processiq.es/login', false, true);
    await this.verifyTarget(this.previous, true);
    console.error(`Previous release restored; failed release and backup retained: ${this.backupDir}`);
  }
}

async function main() {
  process.umask(0o077);
  const sha = parseCommand(process.env.SSH_ORIGINAL_COMMAND);
  process.env.SPI_RELEASE_PATH = releasePath(sha);
  const deployment = new ProductionDeployment(sha);
  const abort = () => deployment.controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  // Continue controlled recovery if the SSH peer closes its output stream.
  process.stdout.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  process.stderr.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  const deadline = setTimeout(abort, 12 * 60 * 1000);
  deadline.unref();
  try { await executeDeployment(deployment); }
  finally { clearTimeout(deadline); }
  console.log(deployment.alreadyActive ? `Already active and verified: ${sha}` : `Deployed ${sha}; PM2 saved. Backup retained: ${deployment.backupDir}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseCommand, releasePath, schemaChanges, otherApps, optionValue, executeDeployment, ProductionDeployment };
