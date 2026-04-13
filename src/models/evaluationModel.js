const { randomUUID } = require('crypto');
const db = require('../db');

async function createEvaluationsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS evaluations (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      season_id CHAR(36) NOT NULL,
      team_id CHAR(36) NOT NULL,
      player_id INT NOT NULL,
      author_id INT NOT NULL,
      evaluation_date DATE NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'manual',
      title VARCHAR(150),
      notes TEXT,
      overall_score DECIMAL(5,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_evaluations_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_evaluations_season
        FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_evaluations_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_evaluations_player
        FOREIGN KEY (player_id) REFERENCES players(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_evaluations_author
        FOREIGN KEY (author_id) REFERENCES users(id)
        ON DELETE RESTRICT,
      KEY idx_evaluations_player_date (player_id, evaluation_date DESC),
      KEY idx_evaluations_team_date (team_id, evaluation_date DESC),
      KEY idx_evaluations_season_date (season_id, evaluation_date DESC),
      KEY idx_evaluations_author_date (author_id, evaluation_date DESC),
      KEY idx_evaluations_club_date (club_id, evaluation_date DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function insertEvaluation(connection, payload) {
  const id = randomUUID();
  await connection.query(
    `INSERT INTO evaluations (
      id, club_id, season_id, team_id, player_id, author_id,
      evaluation_date, source, title, notes, overall_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.clubId,
      payload.seasonId,
      payload.teamId,
      payload.playerId,
      payload.authorId,
      payload.evaluationDate,
      payload.source || 'manual',
      payload.title || null,
      payload.notes || null,
      payload.overallScore,
    ],
  );
  return { id };
}

async function findEvaluationById(id) {
  const [rows] = await db.query(
    `SELECT
        e.*,
        c.name AS club_name,
        s.name AS season_name,
        t.name AS team_name,
        sec.name AS section_name,
        cat.name AS category_name,
        p.first_name,
        p.last_name,
        u.name AS author_name,
        u.email AS author_email
      FROM evaluations e
      INNER JOIN clubs c ON c.id = e.club_id
      INNER JOIN seasons s ON s.id = e.season_id
      INNER JOIN teams t ON t.id = e.team_id
      INNER JOIN sections sec ON sec.id = t.section_id
      INNER JOIN categories cat ON cat.id = t.category_id
      INNER JOIN players p ON p.id = e.player_id
      INNER JOIN users u ON u.id = e.author_id
      WHERE e.id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function listEvaluationsByClub(clubId, filters = {}) {
  let sql = `
    SELECT
      e.id,
      e.club_id,
      e.season_id,
      e.team_id,
      e.player_id,
      e.author_id,
      e.evaluation_date,
      e.source,
      e.title,
      e.notes,
      e.overall_score,
      e.created_at,
      e.updated_at,
      t.name AS team_name,
      s.name AS season_name,
      p.first_name,
      p.last_name,
      u.name AS author_name
    FROM evaluations e
    INNER JOIN teams t ON t.id = e.team_id
    INNER JOIN seasons s ON s.id = e.season_id
    INNER JOIN players p ON p.id = e.player_id
    INNER JOIN users u ON u.id = e.author_id
    WHERE e.club_id = ?
  `;
  const params = [clubId];

  if (filters.teamId) {
    sql += ' AND e.team_id = ?';
    params.push(filters.teamId);
  }
  if (filters.playerId) {
    sql += ' AND e.player_id = ?';
    params.push(filters.playerId);
  }
  if (filters.authorId) {
    sql += ' AND e.author_id = ?';
    params.push(filters.authorId);
  }
  if (filters.dateFrom) {
    sql += ' AND e.evaluation_date >= ?';
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    sql += ' AND e.evaluation_date <= ?';
    params.push(filters.dateTo);
  }

  sql += ' ORDER BY t.name ASC, e.evaluation_date DESC, p.last_name ASC, p.first_name ASC';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function getPlayerEvaluationsByClub(clubId, playerId) {
  const [rows] = await db.query(
    `SELECT
        e.id,
        e.evaluation_date,
        e.source,
        e.title,
        e.notes,
        e.overall_score,
        t.name AS team_name,
        s.name AS season_name,
        u.name AS author_name
      FROM evaluations e
      INNER JOIN teams t ON t.id = e.team_id
      INNER JOIN seasons s ON s.id = e.season_id
      INNER JOIN users u ON u.id = e.author_id
      WHERE e.club_id = ? AND e.player_id = ?
      ORDER BY e.evaluation_date DESC, e.created_at DESC`,
    [clubId, playerId],
  );
  return rows;
}

async function countEvaluationsByTeam(clubId, teamId) {
  if (!clubId || !teamId) {
    return 0;
  }

  const [rows] = await db.query(
    'SELECT COUNT(*) AS total FROM evaluations WHERE club_id = ? AND team_id = ?',
    [clubId, teamId],
  );
  return Number(rows[0] ? rows[0].total : 0);
}

async function listRecentEvaluationsByTeam(clubId, teamId, limit = 3) {
  if (!clubId || !teamId) {
    return [];
  }

  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 3;
  const [rows] = await db.query(
    `SELECT
        e.id,
        e.team_id,
        e.player_id,
        e.author_id,
        e.evaluation_date,
        e.source,
        e.title,
        e.overall_score,
        e.created_at,
        p.first_name,
        p.last_name,
        u.name AS author_name
      FROM evaluations e
      INNER JOIN players p ON p.id = e.player_id
      INNER JOIN users u ON u.id = e.author_id
      WHERE e.club_id = ? AND e.team_id = ?
      ORDER BY e.evaluation_date DESC, e.created_at DESC
      LIMIT ${safeLimit}`,
    [clubId, teamId],
  );

  return rows;
}

module.exports = {
  createEvaluationsTable,
  insertEvaluation,
  findEvaluationById,
  listEvaluationsByClub,
  getPlayerEvaluationsByClub,
  countEvaluationsByTeam,
  listRecentEvaluationsByTeam,
};
