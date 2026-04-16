const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createScoutingTeamOpponentsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS scouting_team_opponents (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      country_name VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_scouting_team_opponents_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      UNIQUE KEY uniq_scouting_team_opponents_club_name (club_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function findScoutingTeamOpponentByName(clubId, name) {
  const [rows] = await db.query(
    `SELECT id, club_id, name, country_name, created_at, updated_at
     FROM scouting_team_opponents
     WHERE club_id = ? AND LOWER(name) = LOWER(?)
     LIMIT 1`,
    [clubId, name],
  );
  return rows[0] || null;
}

async function createScoutingTeamOpponent({ clubId, name, countryName = null }) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO scouting_team_opponents (id, club_id, name, country_name)
     VALUES (?, ?, ?, ?)`,
    [id, clubId, name, countryName],
  );
  return findScoutingTeamOpponentById(clubId, id);
}

async function findScoutingTeamOpponentById(clubId, opponentId) {
  const [rows] = await db.query(
    `SELECT id, club_id, name, country_name, created_at, updated_at
     FROM scouting_team_opponents
     WHERE club_id = ? AND id = ?
     LIMIT 1`,
    [clubId, opponentId],
  );
  return rows[0] || null;
}

module.exports = {
  createScoutingTeamOpponentsTable,
  findScoutingTeamOpponentByName,
  createScoutingTeamOpponent,
  findScoutingTeamOpponentById,
};
