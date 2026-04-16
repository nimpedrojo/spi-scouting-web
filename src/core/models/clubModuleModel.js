const { randomUUID } = require('crypto');
const db = require('../../db');
const { DEFAULT_CLUB_MODULES } = require('../../shared/constants/moduleKeys');

async function createClubModulesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS club_modules (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      module_key VARCHAR(100) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_club_module (club_id, module_key),
      KEY idx_club_modules_club (club_id),
      CONSTRAINT fk_club_modules_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function ensureDefaultModulesForClub(clubId) {
  for (const moduleDefinition of DEFAULT_CLUB_MODULES) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `INSERT INTO club_modules (id, club_id, module_key, enabled)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE module_key = VALUES(module_key)`,
      [
        randomUUID(),
        clubId,
        moduleDefinition.key,
        moduleDefinition.enabled ? 1 : 0,
      ],
    );
  }
}

async function seedDefaultClubModules() {
  const [clubs] = await db.query('SELECT id FROM clubs');

  for (const club of clubs) {
    // eslint-disable-next-line no-await-in-loop
    await ensureDefaultModulesForClub(club.id);
  }
}

async function getModulesByClubId(clubId) {
  await ensureDefaultModulesForClub(clubId);

  let [rows] = await db.query(
    `SELECT id, club_id, module_key, enabled, created_at, updated_at
     FROM club_modules
     WHERE club_id = ?
     ORDER BY module_key ASC`,
    [clubId],
  );

  return rows.map((row) => ({
    id: row.id,
    clubId: row.club_id,
    moduleKey: row.module_key,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function isModuleEnabledForClub(clubId, moduleKey) {
  await ensureDefaultModulesForClub(clubId);

  let [rows] = await db.query(
    'SELECT enabled FROM club_modules WHERE club_id = ? AND module_key = ? LIMIT 1',
    [clubId, moduleKey],
  );

  return Boolean(rows[0] && rows[0].enabled);
}

async function setModuleEnabledForClub(clubId, moduleKey, enabled) {
  await db.query(
    `INSERT INTO club_modules (id, club_id, module_key, enabled)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = CURRENT_TIMESTAMP`,
    [randomUUID(), clubId, moduleKey, enabled ? 1 : 0],
  );
}

module.exports = {
  createClubModulesTable,
  ensureDefaultModulesForClub,
  seedDefaultClubModules,
  getModulesByClubId,
  isModuleEnabledForClub,
  setModuleEnabledForClub,
};
