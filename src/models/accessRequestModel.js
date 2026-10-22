const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

const schema = fs.readFileSync(path.join(__dirname, '../../sql/access-requests.sql'), 'utf8');

async function createAccessRequestsTable() {
  await db.query(schema);
}

async function createAccessRequest(data) {
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO access_requests (id, name, email, organization, position, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.email, data.organization, data.position, data.message],
    );
    return id;
  } catch (error) {
    // A unique email also serializes concurrent submissions. Never overwrite an
    // existing request with unauthenticated input, including after review.
    if (error.code === 'ER_DUP_ENTRY') return null;
    throw error;
  }
}

async function countPendingAccessRequests() {
  const [rows] = await db.query("SELECT COUNT(*) AS total FROM access_requests WHERE status = 'pending'");
  return Number(rows[0].total);
}

async function listAccessRequests({ status, page, pageSize }) {
  const where = status ? ' WHERE status = ?' : '';
  const parameters = status ? [status] : [];
  const [counts] = await db.query(`SELECT COUNT(*) AS total FROM access_requests${where}`, parameters);
  const [rows] = await db.query(
    `SELECT id, name, email, organization, status, created_at FROM access_requests${where}
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...parameters, pageSize, (page - 1) * pageSize],
  );
  return { rows, total: Number(counts[0].total) };
}

async function getAccessRequest(id) {
  const [rows] = await db.query('SELECT * FROM access_requests WHERE id = ?', [id]);
  return rows[0] || null;
}

async function reviewAccessRequest({ id, status, version, reviewerId }) {
  const [result] = await db.query(
    `UPDATE access_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, version = version + 1
     WHERE id = ? AND version = ? AND (status = 'pending' OR (status = 'contacted' AND ? = 'rejected'))`,
    [status, reviewerId, id, version, status],
  );
  return result.affectedRows === 1;
}

module.exports = {
  createAccessRequestsTable, createAccessRequest, countPendingAccessRequests,
  listAccessRequests, getAccessRequest, reviewAccessRequest,
};
