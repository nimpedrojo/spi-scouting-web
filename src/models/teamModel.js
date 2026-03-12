const { randomUUID } = require('crypto');
const db = require('../db');

async function createTeamsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS teams (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      season_id CHAR(36) NOT NULL,
      section_id CHAR(36) NOT NULL,
      category_id CHAR(36) NOT NULL,
      name VARCHAR(150) NOT NULL,
      source VARCHAR(50) NULL,
      external_id VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_teams_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_teams_season
        FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_teams_section
        FOREIGN KEY (section_id) REFERENCES sections(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_teams_category
        FOREIGN KEY (category_id) REFERENCES categories(id)
        ON DELETE RESTRICT,
      UNIQUE KEY uniq_team_scope (club_id, season_id, section_id, category_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  const alterStatements = [
    'ALTER TABLE teams ADD COLUMN source VARCHAR(50) NULL',
    'ALTER TABLE teams ADD COLUMN external_id VARCHAR(100) NULL',
  ];

  for (const statement of alterStatements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.query(statement);
    } catch (e) {
      if (e && e.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error altering teams table', e);
      }
    }
  }
}

async function createTeam({
  clubId,
  seasonId,
  sectionId,
  categoryId,
  name,
  source = null,
  externalId = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name, source, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, clubId, seasonId, sectionId, categoryId, name, source, externalId],
  );
  return findTeamById(id);
}

async function findTeamById(id) {
  const [rows] = await db.query(
    `SELECT
        t.id,
        t.name,
        t.club_id,
        t.season_id,
        t.section_id,
        t.category_id,
        t.source,
        t.external_id,
        t.created_at,
        c.name AS club_name,
        s.name AS season_name,
        s.is_active AS season_is_active,
        sec.name AS section_name,
        cat.name AS category_name
      FROM teams t
      INNER JOIN clubs c ON c.id = t.club_id
      INNER JOIN seasons s ON s.id = t.season_id
      INNER JOIN sections sec ON sec.id = t.section_id
      INNER JOIN categories cat ON cat.id = t.category_id
      WHERE t.id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function updateTeam(id, {
  seasonId,
  sectionId,
  categoryId,
  name,
  source = null,
  externalId = null,
}) {
  const [result] = await db.query(
    `UPDATE teams
     SET season_id = ?, section_id = ?, category_id = ?, name = ?, source = ?, external_id = ?
     WHERE id = ?`,
    [seasonId, sectionId, categoryId, name, source, externalId, id],
  );
  return result.affectedRows;
}

async function deleteTeam(id) {
  const [result] = await db.query('DELETE FROM teams WHERE id = ?', [id]);
  return result.affectedRows;
}

async function getTeamsByClubId(clubId) {
  const [rows] = await db.query(
    `SELECT
        t.id,
        t.name,
        t.club_id,
        t.season_id,
        t.section_id,
        t.category_id,
        t.source,
        t.external_id,
        s.name AS season_name,
        s.is_active AS season_is_active,
        sec.name AS section_name,
        cat.name AS category_name
      FROM teams t
      INNER JOIN seasons s ON s.id = t.season_id
      INNER JOIN sections sec ON sec.id = t.section_id
      INNER JOIN categories cat ON cat.id = t.category_id
      WHERE t.club_id = ?
      ORDER BY sec.name ASC, cat.name ASC, t.name ASC`,
    [clubId],
  );
  return rows;
}

module.exports = {
  createTeamsTable,
  createTeam,
  findTeamById,
  updateTeam,
  deleteTeam,
  getTeamsByClubId,
};
