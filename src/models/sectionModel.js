const { randomUUID } = require('crypto');
const db = require('../db');

const DEFAULT_SECTIONS = ['Masculina', 'Femenina'];

async function createSectionsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS sections (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function seedDefaultSections() {
  for (const name of DEFAULT_SECTIONS) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      'INSERT INTO sections (id, name) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sections WHERE name = ?)',
      [randomUUID(), name, name],
    );
  }
}

async function getAllSections() {
  const [rows] = await db.query(
    'SELECT id, name, created_at FROM sections ORDER BY FIELD(name, "Masculina", "Femenina"), name ASC',
  );
  return rows;
}

async function findSectionById(id) {
  const [rows] = await db.query('SELECT id, name, created_at FROM sections WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports = {
  DEFAULT_SECTIONS,
  createSectionsTable,
  seedDefaultSections,
  getAllSections,
  findSectionById,
};
