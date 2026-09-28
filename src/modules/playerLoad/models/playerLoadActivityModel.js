const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createPlayerLoadActivitiesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS player_load_activities (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      season_id CHAR(36) NOT NULL,
      team_id CHAR(36) NOT NULL,
      activity_type VARCHAR(20) NOT NULL,
      activity_date DATE NOT NULL,
      title VARCHAR(150) NOT NULL,
      duration_minutes INT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'done',
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_player_load_activities_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_player_load_activities_season
        FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_player_load_activities_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_player_load_activities_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL,
      KEY idx_player_load_activities_team_date (team_id, activity_date),
      KEY idx_player_load_activities_club_season (club_id, season_id),
      KEY idx_player_load_activities_type_date (activity_type, activity_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(sql);
}

function mapActivityRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    club_id: row.club_id,
    season_id: row.season_id,
    team_id: row.team_id,
    activity_type: row.activity_type,
    activity_date: row.activity_date,
    title: row.title,
    duration_minutes: row.duration_minutes !== null ? Number(row.duration_minutes) : null,
    status: row.status || 'done',
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    team_name: row.team_name,
    season_name: row.season_name,
    club_name: row.club_name,
    author_name: row.author_name,
  };
}

async function createPlayerLoadActivity({
  clubId,
  seasonId,
  teamId,
  activityType,
  activityDate,
  title,
  durationMinutes = null,
  status = 'done',
  notes = null,
  createdBy = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO player_load_activities (
      id, club_id, season_id, team_id, activity_type, activity_date, title,
      duration_minutes, status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      clubId,
      seasonId,
      teamId,
      activityType,
      activityDate,
      title,
      durationMinutes,
      status,
      notes,
      createdBy,
    ],
  );

  return findPlayerLoadActivityById(id);
}

async function findPlayerLoadActivityById(id) {
  const [rows] = await db.query(
    `SELECT
        pla.*,
        c.name AS club_name,
        s.name AS season_name,
        t.name AS team_name,
        u.name AS author_name
      FROM player_load_activities pla
      INNER JOIN clubs c ON c.id = pla.club_id
      INNER JOIN seasons s ON s.id = pla.season_id
      INNER JOIN teams t ON t.id = pla.team_id
      LEFT JOIN users u ON u.id = pla.created_by
      WHERE pla.id = ?
      LIMIT 1`,
    [id],
  );

  return mapActivityRow(rows[0]);
}

async function listPlayerLoadActivities(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.clubId) {
    conditions.push('pla.club_id = ?');
    params.push(filters.clubId);
  }
  if (filters.seasonId) {
    conditions.push('pla.season_id = ?');
    params.push(filters.seasonId);
  }
  if (filters.teamId) {
    conditions.push('pla.team_id = ?');
    params.push(filters.teamId);
  }
  if (filters.activityType) {
    conditions.push('pla.activity_type = ?');
    params.push(filters.activityType);
  }
  if (filters.dateFrom) {
    conditions.push('pla.activity_date >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('pla.activity_date <= ?');
    params.push(filters.dateTo);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await db.query(
    `SELECT
        pla.*,
        c.name AS club_name,
        s.name AS season_name,
        t.name AS team_name,
        u.name AS author_name
      FROM player_load_activities pla
      INNER JOIN clubs c ON c.id = pla.club_id
      INNER JOIN seasons s ON s.id = pla.season_id
      INNER JOIN teams t ON t.id = pla.team_id
      LEFT JOIN users u ON u.id = pla.created_by
      ${whereClause}
      ORDER BY pla.activity_date DESC, pla.created_at DESC`,
    params,
  );

  return rows.map(mapActivityRow);
}

async function updatePlayerLoadActivity(id, {
  activityType,
  activityDate,
  title,
  durationMinutes = null,
  status = 'done',
  notes = null,
}) {
  const [result] = await db.query(
    `UPDATE player_load_activities
     SET activity_type = ?, activity_date = ?, title = ?, duration_minutes = ?, status = ?, notes = ?
     WHERE id = ?`,
    [activityType, activityDate, title, durationMinutes, status, notes, id],
  );

  return result.affectedRows;
}

async function deletePlayerLoadActivity(id) {
  const [result] = await db.query('DELETE FROM player_load_activities WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createPlayerLoadActivitiesTable,
  createPlayerLoadActivity,
  findPlayerLoadActivityById,
  listPlayerLoadActivities,
  updatePlayerLoadActivity,
  deletePlayerLoadActivity,
};
