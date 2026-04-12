const { randomUUID } = require('crypto');
const db = require('../db');

async function createTeamPlayersTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS team_players (
      id CHAR(36) PRIMARY KEY,
      team_id CHAR(36) NOT NULL,
      player_id INT NOT NULL,
      dorsal VARCHAR(10),
      positions VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_team_players_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_team_players_player
        FOREIGN KEY (player_id) REFERENCES players(id)
        ON DELETE CASCADE,
      UNIQUE KEY uniq_team_player (team_id, player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function upsertTeamPlayer({ teamId, playerId, dorsal = null, positions = null }) {
  const existing = await findTeamPlayer(teamId, playerId);
  if (existing) {
    await db.query(
      'UPDATE team_players SET dorsal = ?, positions = ? WHERE id = ?',
      [dorsal, positions, existing.id],
    );
    return findTeamPlayer(teamId, playerId);
  }

  const id = randomUUID();
  await db.query(
    `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
     VALUES (?, ?, ?, ?, ?)`,
    [id, teamId, playerId, dorsal, positions],
  );
  return findTeamPlayer(teamId, playerId);
}

async function findTeamPlayer(teamId, playerId) {
  const [rows] = await db.query(
    'SELECT id, team_id, player_id, dorsal, positions, created_at FROM team_players WHERE team_id = ? AND player_id = ?',
    [teamId, playerId],
  );
  return rows[0] || null;
}

async function getPlayersByTeamId(teamId) {
  const [rows] = await db.query(
    `SELECT
        tp.id,
        tp.team_id,
        tp.player_id,
        tp.dorsal,
        tp.positions,
        t.name AS team_name,
        p.first_name,
        p.last_name,
        p.current_team_id,
        p.club_id,
        p.birth_year,
        p.laterality
      FROM team_players tp
      INNER JOIN teams t ON t.id = tp.team_id
      INNER JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = ?
      ORDER BY
        CASE WHEN tp.dorsal IS NULL OR tp.dorsal = '' THEN 1 ELSE 0 END,
        CAST(NULLIF(tp.dorsal, '') AS UNSIGNED),
        p.last_name ASC,
        p.first_name ASC`,
    [teamId],
  );
  return rows;
}

async function getPlayersByTeamIds(teamIds) {
  if (!teamIds || !teamIds.length) {
    return [];
  }

  const placeholders = teamIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT
        tp.id,
        tp.team_id,
        tp.player_id,
        tp.dorsal,
        tp.positions,
        t.name AS team_name,
        p.first_name,
        p.last_name,
        p.current_team_id,
        p.club_id,
        p.birth_year,
        p.laterality
      FROM team_players tp
      INNER JOIN teams t ON t.id = tp.team_id
      INNER JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id IN (${placeholders})
      ORDER BY
        tp.team_id ASC,
        CASE WHEN tp.dorsal IS NULL OR tp.dorsal = '' THEN 1 ELSE 0 END,
        CAST(NULLIF(tp.dorsal, '') AS UNSIGNED),
        p.last_name ASC,
        p.first_name ASC`,
    teamIds,
  );
  return rows;
}

async function deleteTeamPlayersByTeamId(teamId) {
  await db.query('DELETE FROM team_players WHERE team_id = ?', [teamId]);
}

async function deleteTeamPlayersByPlayerId(playerId) {
  await db.query('DELETE FROM team_players WHERE player_id = ?', [playerId]);
}

module.exports = {
  createTeamPlayersTable,
  upsertTeamPlayer,
  findTeamPlayer,
  getPlayersByTeamId,
  getPlayersByTeamIds,
  deleteTeamPlayersByTeamId,
  deleteTeamPlayersByPlayerId,
};
