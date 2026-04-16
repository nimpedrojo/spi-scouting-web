const db = require('../../db');
const { DEFAULT_PRODUCT_MODE } = require('../../shared/constants/productModes');

async function createPlatformSettingsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS platform_settings (
      id TINYINT PRIMARY KEY,
      default_product_mode VARCHAR(50) NOT NULL DEFAULT '${DEFAULT_PRODUCT_MODE}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  const alterStatements = [
    `ALTER TABLE platform_settings ADD COLUMN default_product_mode VARCHAR(50) NOT NULL DEFAULT '${DEFAULT_PRODUCT_MODE}'`,
  ];

  for (const statement of alterStatements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.query(statement);
    } catch (error) {
      if (error && error.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error altering platform_settings table', error);
      }
    }
  }
}

async function ensurePlatformSettingsRow() {
  await db.query(
    `INSERT INTO platform_settings (id, default_product_mode)
     VALUES (1, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [DEFAULT_PRODUCT_MODE],
  );
}

async function getPlatformSettings() {
  const [rows] = await db.query(
    'SELECT id, default_product_mode, created_at, updated_at FROM platform_settings WHERE id = 1',
  );
  return rows[0] || null;
}

async function updatePlatformSettings({ defaultProductMode }) {
  const [result] = await db.query(
    `INSERT INTO platform_settings (id, default_product_mode)
     VALUES (1, ?)
     ON DUPLICATE KEY UPDATE default_product_mode = VALUES(default_product_mode)`,
    [defaultProductMode],
  );
  return result.affectedRows;
}

module.exports = {
  createPlatformSettingsTable,
  ensurePlatformSettingsRow,
  getPlatformSettings,
  updatePlatformSettings,
};
