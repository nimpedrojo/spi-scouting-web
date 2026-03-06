const { randomUUID } = require('crypto');
const db = require('../db');

const DEFAULT_CATEGORIES = [
  'Juvenil',
  'Cadete',
  'Infantil',
  'Alevín',
  'Benjamín',
  'Prebenjamín',
  'Debutantes',
];

async function createCategoriesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS categories (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function seedDefaultCategories() {
  for (const [index, name] of DEFAULT_CATEGORIES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `INSERT INTO categories (id, name, sort_order)
       SELECT ?, ?, ?
       FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = ?)`,
      [randomUUID(), name, index + 1, name],
    );
  }
}

async function getAllCategories() {
  const [rows] = await db.query(
    'SELECT id, name, sort_order, created_at FROM categories ORDER BY sort_order ASC, name ASC',
  );
  return rows;
}

async function findCategoryById(id) {
  const [rows] = await db.query(
    'SELECT id, name, sort_order, created_at FROM categories WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  DEFAULT_CATEGORIES,
  createCategoriesTable,
  seedDefaultCategories,
  getAllCategories,
  findCategoryById,
};
