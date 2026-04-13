const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createScoutingTeamReportsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS scouting_team_reports (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      own_team_id CHAR(36) NULL,
      opponent_id CHAR(36) NOT NULL,
      created_by INT NULL,
      match_date DATE NULL,
      competition VARCHAR(150) NULL,
      system_shape VARCHAR(50) NULL,
      style_in_possession TEXT NULL,
      style_out_of_possession TEXT NULL,
      transitions TEXT NULL,
      set_pieces TEXT NULL,
      strengths TEXT NULL,
      weaknesses TEXT NULL,
      key_players TEXT NULL,
      general_observations TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_scouting_team_reports_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_scouting_team_reports_team
        FOREIGN KEY (own_team_id) REFERENCES teams(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_scouting_team_reports_opponent
        FOREIGN KEY (opponent_id) REFERENCES scouting_team_opponents(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_scouting_team_reports_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL,
      KEY idx_scouting_team_reports_club_date (club_id, match_date),
      KEY idx_scouting_team_reports_opponent (opponent_id),
      KEY idx_scouting_team_reports_team (own_team_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

function mapReportRow(row) {
  return {
    id: row.id,
    clubId: row.club_id,
    ownTeamId: row.own_team_id,
    opponentId: row.opponent_id,
    createdBy: row.created_by,
    matchDate: row.match_date,
    competition: row.competition,
    systemShape: row.system_shape,
    styleInPossession: row.style_in_possession,
    styleOutOfPossession: row.style_out_of_possession,
    transitions: row.transitions,
    setPieces: row.set_pieces,
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    keyPlayers: row.key_players,
    generalObservations: row.general_observations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    opponentName: row.opponent_name,
    opponentCountryName: row.opponent_country_name,
    ownTeamName: row.own_team_name,
    authorName: row.author_name,
    authorEmail: row.author_email,
  };
}

async function listScoutingTeamReportsByClub(clubId, filters = {}) {
  const conditions = ['r.club_id = ?'];
  const params = [clubId];

  if (filters.teamId) {
    conditions.push('r.own_team_id = ?');
    params.push(filters.teamId);
  }

  if (filters.search) {
    conditions.push('(o.name LIKE ? OR r.competition LIKE ? OR t.name LIKE ?)');
    const query = `%${filters.search}%`;
    params.push(query, query, query);
  }

  const [rows] = await db.query(
    `SELECT
        r.*,
        o.name AS opponent_name,
        o.country_name AS opponent_country_name,
        t.name AS own_team_name,
        u.name AS author_name,
        u.email AS author_email
      FROM scouting_team_reports r
      INNER JOIN scouting_team_opponents o ON o.id = r.opponent_id
      LEFT JOIN teams t ON t.id = r.own_team_id
      LEFT JOIN users u ON u.id = r.created_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.match_date DESC, r.created_at DESC`,
    params,
  );

  return rows.map(mapReportRow);
}

async function findScoutingTeamReportById(clubId, reportId) {
  const [rows] = await db.query(
    `SELECT
        r.*,
        o.name AS opponent_name,
        o.country_name AS opponent_country_name,
        t.name AS own_team_name,
        u.name AS author_name,
        u.email AS author_email
      FROM scouting_team_reports r
      INNER JOIN scouting_team_opponents o ON o.id = r.opponent_id
      LEFT JOIN teams t ON t.id = r.own_team_id
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.club_id = ? AND r.id = ?
      LIMIT 1`,
    [clubId, reportId],
  );

  return rows[0] ? mapReportRow(rows[0]) : null;
}

async function createScoutingTeamReport({
  clubId,
  ownTeamId = null,
  opponentId,
  createdBy = null,
  matchDate = null,
  competition = null,
  systemShape = null,
  styleInPossession = null,
  styleOutOfPossession = null,
  transitions = null,
  setPieces = null,
  strengths = null,
  weaknesses = null,
  keyPlayers = null,
  generalObservations = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO scouting_team_reports (
      id, club_id, own_team_id, opponent_id, created_by, match_date, competition,
      system_shape, style_in_possession, style_out_of_possession, transitions,
      set_pieces, strengths, weaknesses, key_players, general_observations
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      clubId,
      ownTeamId,
      opponentId,
      createdBy,
      matchDate,
      competition,
      systemShape,
      styleInPossession,
      styleOutOfPossession,
      transitions,
      setPieces,
      strengths,
      weaknesses,
      keyPlayers,
      generalObservations,
    ],
  );
  return findScoutingTeamReportById(clubId, id);
}

async function updateScoutingTeamReport(clubId, reportId, {
  ownTeamId = null,
  opponentId,
  matchDate = null,
  competition = null,
  systemShape = null,
  styleInPossession = null,
  styleOutOfPossession = null,
  transitions = null,
  setPieces = null,
  strengths = null,
  weaknesses = null,
  keyPlayers = null,
  generalObservations = null,
}) {
  const [result] = await db.query(
    `UPDATE scouting_team_reports
     SET own_team_id = ?, opponent_id = ?, match_date = ?, competition = ?, system_shape = ?,
         style_in_possession = ?, style_out_of_possession = ?, transitions = ?, set_pieces = ?,
         strengths = ?, weaknesses = ?, key_players = ?, general_observations = ?
     WHERE club_id = ? AND id = ?`,
    [
      ownTeamId,
      opponentId,
      matchDate,
      competition,
      systemShape,
      styleInPossession,
      styleOutOfPossession,
      transitions,
      setPieces,
      strengths,
      weaknesses,
      keyPlayers,
      generalObservations,
      clubId,
      reportId,
    ],
  );

  if (!result.affectedRows) {
    return null;
  }

  return findScoutingTeamReportById(clubId, reportId);
}

async function deleteScoutingTeamReport(clubId, reportId) {
  const [result] = await db.query(
    'DELETE FROM scouting_team_reports WHERE club_id = ? AND id = ?',
    [clubId, reportId],
  );
  return result.affectedRows;
}

async function countScoutingTeamReportsByClub(clubId) {
  const [rows] = await db.query(
    'SELECT COUNT(*) AS total FROM scouting_team_reports WHERE club_id = ?',
    [clubId],
  );
  return Number(rows[0] ? rows[0].total : 0);
}

async function countScoutingTeamReportsByOwnTeam(clubId, ownTeamId) {
  if (!clubId || !ownTeamId) {
    return 0;
  }

  const [rows] = await db.query(
    'SELECT COUNT(*) AS total FROM scouting_team_reports WHERE club_id = ? AND own_team_id = ?',
    [clubId, ownTeamId],
  );
  return Number(rows[0] ? rows[0].total : 0);
}

async function listRecentScoutingTeamReportsByOwnTeam(clubId, ownTeamId, limit = 3) {
  if (!clubId || !ownTeamId) {
    return [];
  }

  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 3;
  const [rows] = await db.query(
    `SELECT
        r.*,
        o.name AS opponent_name,
        o.country_name AS opponent_country_name,
        t.name AS own_team_name,
        u.name AS author_name,
        u.email AS author_email
      FROM scouting_team_reports r
      INNER JOIN scouting_team_opponents o ON o.id = r.opponent_id
      LEFT JOIN teams t ON t.id = r.own_team_id
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.club_id = ? AND r.own_team_id = ?
      ORDER BY r.match_date DESC, r.created_at DESC
      LIMIT ${safeLimit}`,
    [clubId, ownTeamId],
  );

  return rows.map(mapReportRow);
}

module.exports = {
  createScoutingTeamReportsTable,
  listScoutingTeamReportsByClub,
  findScoutingTeamReportById,
  createScoutingTeamReport,
  updateScoutingTeamReport,
  deleteScoutingTeamReport,
  countScoutingTeamReportsByClub,
  countScoutingTeamReportsByOwnTeam,
  listRecentScoutingTeamReportsByOwnTeam,
};
