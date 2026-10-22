// SQL-only rehearsal against an explicitly isolated, restricted clone. No app start.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PINS, assertPins } = require('./release-access-requests.cjs');

function assertRehearsalConfig(env) {
  if (!/^spi_rehearsal_[a-zA-Z0-9_]+$/.test(env.DB_NAME || '')
    || !/^spi_rehearsal(?:_[a-zA-Z0-9_]+)?$/.test(env.DB_USER || '')
    || !['127.0.0.1', 'localhost'].includes(env.DB_HOST) || !/^\d{1,5}$/.test(env.DB_PORT || '')
    || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535) {
    throw new Error('Use a local spi_rehearsal_* database and a restricted spi_rehearsal[_suffix] account; never production/root');
  }
}

async function main() {
  process.umask(0o077);
  const envFile = process.argv[2];
  if (process.argv.length !== 3 || !envFile || !path.isAbsolute(envFile)) throw new Error('Pass the absolute PRIVATE rehearsal .env path');
  if (process.getuid() === 0) throw new Error('Run as application owner, not root');
  const current = await fs.realpath('/var/www/spi-scouting-deploy/current');
  const dotenv = require(`${current}/node_modules/dotenv`);
  const env = dotenv.parse(await fs.readFile(envFile));
  assertRehearsalConfig(env);
  const contents = {};
  for (const file of Object.keys(PINS)) contents[file] = await fs.readFile(path.join(__dirname, '..', file));
  assertPins(contents);
  const mysql = require(`${current}/node_modules/mysql2/promise`);
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD || '', database: env.DB_NAME, connectTimeout: 10000 });
  const id = randomUUID();
  const email = `rehearsal-${id}@example.invalid`;
  let reviewerId;
  try {
    const [[identity]] = await connection.query('SELECT DATABASE() AS db, CURRENT_USER() AS account');
    if (identity.db !== env.DB_NAME || !identity.account.startsWith(env.DB_USER+'@')) throw new Error('Unexpected SQL identity');
    await connection.query(contents['sql/access-requests.sql'].toString('utf8'));
    const [reviewer] = await connection.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')",
      ['Disposable schema rehearsal', email, 'not-a-login-hash'],
    );
    reviewerId = reviewer.insertId;
    await connection.query('INSERT INTO access_requests (id, name, email, organization) VALUES (?, ?, ?, ?)', [id, 'Schema rehearsal', email, 'Fixture only']);
    await connection.query(contents['sql/access-requests.sql'].toString('utf8'));
    const [[preserved]] = await connection.query('SELECT COUNT(*) AS total FROM access_requests WHERE id = ?', [id]);
    if (Number(preserved.total) !== 1) throw new Error('Idempotent initialization lost its fixture');
    let duplicateRejected = false;
    try { await connection.query('INSERT INTO access_requests (id, name, email, organization) VALUES (?, ?, ?, ?)', [randomUUID(), 'Duplicate', email.toUpperCase(), 'Fixture only']); }
    catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; duplicateRejected = true; }
    if (!duplicateRejected) throw new Error('Email uniqueness was not enforced');
    const [updated] = await connection.query("UPDATE access_requests SET status = 'contacted', version = version + 1, reviewed_by = ? WHERE id = ? AND version = 0", [reviewerId, id]);
    const [stale] = await connection.query("UPDATE access_requests SET status = 'rejected', version = version + 1 WHERE id = ? AND version = 0", [id]);
    if (updated.affectedRows !== 1 || stale.affectedRows !== 0) throw new Error('Optimistic update failed');
    await connection.query('DELETE FROM users WHERE id = ? AND email = ?', [reviewerId, email]);
    const [[checked]] = await connection.query('SELECT reviewed_by FROM access_requests WHERE id = ?', [id]);
    if (checked.reviewed_by !== null) throw new Error('Reviewer FK SET NULL failed');
    console.log('SQL rehearsal OK: creation twice, preservation, unique email, optimistic update, FK SET NULL.');
    console.log('Only the isolated clone was used. This does not rehearse full app/PM2 activation.');
  } finally {
    try {
      await connection.query('DELETE FROM access_requests WHERE id = ? AND email = ?', [id, email]);
      if (reviewerId) await connection.query('DELETE FROM users WHERE id = ? AND email = ?', [reviewerId, email]);
    } finally { await connection.end(); }
  }
}

if (require.main === module) main().catch(() => {
  console.error('Schema rehearsal failed. Inspect the PRIVATE clone/configuration; no SQL or credentials printed.');
  process.exitCode = 1;
});
module.exports = { assertRehearsalConfig };
