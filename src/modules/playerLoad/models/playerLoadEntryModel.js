const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createPlayerLoadEntriesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS player_load_entries (
      id CHAR(36) PRIMARY KEY,
      activity_id CHAR(36) NOT NULL,
      player_id INT NOT NULL,
      attended TINYINT(1) NOT NULL DEFAULT 1,
      exposure_minutes INT NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_player_load_entries_activity
        FOREIGN KEY (activity_id) REFERENCES player_load_activities(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_player_load_entries_player
        FOREIGN KEY (player_id) REFERENCES players(id)
        ON DELETE CASCADE,
      UNIQUE KEY uniq_player_load_entry (activity_id, player_id),
      KEY idx_player_load_entries_player (player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(sql);
}

function mapEntryRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    activity_id: row.activity_id,
    player_id: row.player_id,
    attended: Boolean(row.attended),
    exposure_minutes: Number(row.exposure_minutes || 0),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    first_name: row.first_name,
    last_name: row.last_name,
    dorsal: row.dorsal,
    positions: row.positions,
    activity_type: row.activity_type,
    activity_date: row.activity_date,
    status: row.status || 'done',
    team_id: row.team_id,
    season_id: row.season_id,
  };
}

async function replacePlayerLoadEntries(activityId, entries = []) {
  await db.query('DELETE FROM player_load_entries WHERE activity_id = ?', [activityId]);

  if (!entries.length) {
    return [];
  }

  const values = entries.map((entry) => ([
    randomUUID(),
    activityId,
    entry.playerId,
    entry.attended ? 1 : 0,
    Number(entry.exposureMinutes || 0),
    entry.notes || null,
  ]));

  await db.query(
    `INSERT INTO player_load_entries (
      id, activity_id, player_id, attended, exposure_minutes, notes
    ) VALUES ?`,
    [values],
  );

  return listPlayerLoadEntriesByActivity(activityId);
}

async function listPlayerLoadEntriesByActivity(activityId) {
  const [rows] = await db.query(
    `SELECT
        ple.*,
        p.first_name,
        p.last_name,
        pla.activity_type,
        pla.activity_date,
        pla.status,
        pla.team_id,
        pla.season_id,
        tp.dorsal,
        tp.positions
      FROM player_load_entries ple
      INNER JOIN players p ON p.id = ple.player_id
      INNER JOIN player_load_activities pla ON pla.id = ple.activity_id
      LEFT JOIN team_players tp ON tp.team_id = pla.team_id AND tp.player_id = ple.player_id
      WHERE ple.activity_id = ?
      ORDER BY
        CASE WHEN tp.dorsal IS NULL OR tp.dorsal = '' THEN 1 ELSE 0 END,
        CAST(NULLIF(tp.dorsal, '') AS UNSIGNED),
        p.last_name ASC,
        p.first_name ASC`,
    [activityId],
  );

  return rows.map(mapEntryRow);
}

async function listPlayerLoadEntriesForTeamPeriod({
  clubId,
  seasonId,
  teamId,
  dateFrom = null,
  dateTo = null,
}) {
  const conditions = [
    'pla.club_id = ?',
    'pla.season_id = ?',
    'pla.team_id = ?',
  ];
  const params = [clubId, seasonId, teamId];

  if (dateFrom) {
    conditions.push('pla.activity_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('pla.activity_date <= ?');
    params.push(dateTo);
  }

  const [rows] = await db.query(
    `SELECT
        ple.*,
        pla.activity_type,
        pla.activity_date,
        pla.status,
        pla.team_id,
        pla.season_id,
        p.first_name,
        p.last_name,
        tp.dorsal,
        tp.positions
      FROM player_load_entries ple
      INNER JOIN player_load_activities pla ON pla.id = ple.activity_id
      INNER JOIN players p ON p.id = ple.player_id
      LEFT JOIN team_players tp ON tp.team_id = pla.team_id AND tp.player_id = ple.player_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pla.activity_date ASC, p.last_name ASC, p.first_name ASC`,
    params,
  );

  return rows.map(mapEntryRow);
}

module.exports = {
  createPlayerLoadEntriesTable,
  replacePlayerLoadEntries,
  listPlayerLoadEntriesByActivity,
  listPlayerLoadEntriesForTeamPeriod,
};
