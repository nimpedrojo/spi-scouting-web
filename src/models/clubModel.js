const db = require('../db');
const { ensureDefaultModulesForClub } = require('../core/models/clubModuleModel');
const { DEFAULT_PRODUCT_MODE } = require('../shared/constants/productModes');

async function createClubsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS clubs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      interface_color VARCHAR(7) NULL,
      crest_path VARCHAR(255) NULL,
      product_mode VARCHAR(50) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  const alterStatements = [
    'ALTER TABLE clubs ADD COLUMN interface_color VARCHAR(7) NULL',
    'ALTER TABLE clubs ADD COLUMN crest_path VARCHAR(255) NULL',
    'ALTER TABLE clubs ADD COLUMN product_mode VARCHAR(50) NULL',
  ];

  for (const statement of alterStatements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.query(statement);
    } catch (e) {
      if (e && e.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error altering clubs table', e);
      }
    }
  }
}

async function createClub({ name, code }) {
  const [result] = await db.query(
    'INSERT INTO clubs (name, code, interface_color, crest_path, product_mode) VALUES (?, ?, NULL, NULL, NULL)',
    [name, code],
  );
  await ensureDefaultModulesForClub(result.insertId);
  return result.insertId;
}

async function getAllClubs() {
  const [rows] = await db.query(
    'SELECT id, name, code, interface_color, crest_path, created_at FROM clubs ORDER BY name ASC',
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

async function updateClubBranding(id, { interfaceColor = null, crestPath }) {
  let sql = 'UPDATE clubs SET interface_color = ?';
  const params = [interfaceColor];

  if (crestPath !== undefined) {
    sql += ', crest_path = ?';
    params.push(crestPath);
  }

  sql += ' WHERE id = ?';
  params.push(id);

  const [result] = await db.query(sql, params);
  return result.affectedRows;
}

async function updateClubProductMode(id, productMode = null) {
  const normalizedValue = productMode === DEFAULT_PRODUCT_MODE ? null : productMode;
  const [result] = await db.query(
    'UPDATE clubs SET product_mode = ? WHERE id = ?',
    [normalizedValue, id],
  );
  return result.affectedRows;
}

async function deleteClub(id) {
  const [result] = await db.query('DELETE FROM clubs WHERE id = ?', [id]);
  return result.affectedRows;
}

async function deleteClubDependencies({ clubId, clubName }) {
  await db.query('DELETE FROM club_modules WHERE club_id = ?', [clubId]);
  await db.query('DELETE FROM evaluations WHERE club_id = ?', [clubId]);
  await db.query('DELETE FROM club_recommendations WHERE club = ?', [clubName]);
  await db.query('DELETE FROM reports WHERE club = ?', [clubName]);
  await db.query('DELETE FROM evaluation_templates WHERE club_id = ?', [clubId]);
  await db.query('DELETE FROM players WHERE club_id = ? OR club = ?', [clubId, clubName]);
  await db.query('DELETE FROM teams WHERE club_id = ?', [clubId]);
  await db.query('DELETE FROM seasons WHERE club_id = ?', [clubId]);
}

module.exports = {
  createClubsTable,
  createClub,
  getAllClubs,
  getClubByCode,
  getClubByName,
  getClubById,
  updateClub,
  updateClubBranding,
  updateClubProductMode,
  deleteClubDependencies,
  deleteClub,
};
