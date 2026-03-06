const { randomUUID } = require('crypto');
const db = require('../db');

async function createSeasonsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS seasons (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      name VARCHAR(50) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_seasons_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      UNIQUE KEY uniq_club_season_name (club_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  try {
    await db.query('ALTER TABLE seasons ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 0');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding is_active to seasons', e);
    }
  }
}

function getDefaultSeasonName(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = String(startYear + 1).slice(-2);
  return `${startYear}/${endYear}`;
}

async function findActiveSeasonByClubId(clubId) {
  const [rows] = await db.query(
    `SELECT id, club_id, name, is_active, created_at
     FROM seasons
     WHERE club_id = ? AND is_active = 1
     ORDER BY created_at DESC
     LIMIT 1`,
    [clubId],
  );
  return rows[0] || null;
}

async function getSeasonsByClubId(clubId) {
  const [rows] = await db.query(
    `SELECT id, club_id, name, is_active, created_at
     FROM seasons
     WHERE club_id = ?
     ORDER BY is_active DESC, name DESC`,
    [clubId],
  );
  return rows;
}

async function createSeason({ clubId, name, isActive = false }) {
  const id = randomUUID();
  if (isActive) {
    await db.query('UPDATE seasons SET is_active = 0 WHERE club_id = ?', [clubId]);
  }
  await db.query(
    'INSERT INTO seasons (id, club_id, name, is_active) VALUES (?, ?, ?, ?)',
    [id, clubId, name, isActive ? 1 : 0],
  );
  return findSeasonById(id);
}

async function findSeasonById(id) {
  const [rows] = await db.query(
    'SELECT id, club_id, name, is_active, created_at FROM seasons WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

async function ensureActiveSeasonForClub(clubId) {
  const current = await findActiveSeasonByClubId(clubId);
  if (current) {
    return current;
  }

  const seasons = await getSeasonsByClubId(clubId);
  if (seasons.length) {
    await db.query('UPDATE seasons SET is_active = 1 WHERE id = ?', [seasons[0].id]);
    return findSeasonById(seasons[0].id);
  }

  return createSeason({
    clubId,
    name: getDefaultSeasonName(),
    isActive: true,
  });
}

module.exports = {
  createSeasonsTable,
  getDefaultSeasonName,
  findActiveSeasonByClubId,
  getSeasonsByClubId,
  createSeason,
  findSeasonById,
  ensureActiveSeasonForClub,
};
