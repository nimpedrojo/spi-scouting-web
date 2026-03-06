const db = require('../db');

async function createClubsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS clubs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function createClub({ name, code }) {
  const [result] = await db.query(
    'INSERT INTO clubs (name, code) VALUES (?, ?)',
    [name, code],
  );
  return result.insertId;
}

async function getAllClubs() {
  const [rows] = await db.query(
    'SELECT id, name, code, created_at FROM clubs ORDER BY name ASC',
  );
  return rows;
}

async function getClubByCode(code) {
  const [rows] = await db.query('SELECT * FROM clubs WHERE code = ?', [code]);
  return rows[0];
}

async function getClubByName(name) {
  const [rows] = await db.query('SELECT * FROM clubs WHERE name = ?', [name]);
  return rows[0];
}

async function getClubById(id) {
  const [rows] = await db.query('SELECT * FROM clubs WHERE id = ?', [id]);
  return rows[0];
}

async function updateClub(id, { name }) {
  const [result] = await db.query(
    'UPDATE clubs SET name = ? WHERE id = ?',
    [name, id],
  );
  return result.affectedRows;
}

async function deleteClub(id) {
  const [result] = await db.query('DELETE FROM clubs WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createClubsTable,
  createClub,
  getAllClubs,
  getClubByCode,
  getClubByName,
  getClubById,
  updateClub,
  deleteClub,
};
