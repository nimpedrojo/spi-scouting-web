const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createPlanSessionsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS plan_sessions (
      id CHAR(36) PRIMARY KEY,
      microcycle_id CHAR(36) NOT NULL,
      session_date DATE NOT NULL,
      title VARCHAR(150) NOT NULL,
      session_type VARCHAR(100) NULL,
      duration_minutes INT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'planned',
      objective TEXT NULL,
      contents TEXT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_plan_sessions_microcycle_date (microcycle_id, session_date),
      CONSTRAINT fk_plan_sessions_microcycle
        FOREIGN KEY (microcycle_id) REFERENCES plan_microcycles(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(sql);

  try {
    await db.query("ALTER TABLE plan_sessions ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'planned'");
  } catch (error) {
    if (error && error.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding plan_sessions.status column', error);
    }
  }
}

function mapSessionRow(row) {
  return {
    id: row.id,
    microcycle_id: row.microcycle_id,
    session_date: row.session_date,
    title: row.title,
    session_type: row.session_type,
    duration_minutes: row.duration_minutes !== null ? Number(row.duration_minutes) : null,
    status: row.status || 'planned',
    objective: row.objective,
    contents: row.contents,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    microcycle_name: row.microcycle_name,
    season_plan_id: row.season_plan_id,
    team_name: row.team_name,
    task_count: Number(row.task_count || 0),
  };
}

async function createPlanSession({
  microcycleId,
  sessionDate,
  title,
  sessionType = null,
  durationMinutes = null,
  status = 'planned',
  objective = null,
  contents = null,
  notes = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO plan_sessions (
      id, microcycle_id, session_date, title, session_type, duration_minutes, status, objective, contents, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, microcycleId, sessionDate, title, sessionType, durationMinutes, status, objective, contents, notes],
  );

  return findPlanSessionById(id);
}

async function findPlanSessionById(id) {
  const [rows] = await db.query(
    `SELECT
        ps.*,
        pm.name AS microcycle_name,
        pm.season_plan_id,
        t.name AS team_name,
        COUNT(DISTINCT pst.id) AS task_count
      FROM plan_sessions ps
      INNER JOIN plan_microcycles pm ON pm.id = ps.microcycle_id
      INNER JOIN season_plans sp ON sp.id = pm.season_plan_id
      INNER JOIN teams t ON t.id = sp.team_id
      LEFT JOIN plan_session_tasks pst ON pst.session_id = ps.id
      WHERE ps.id = ?
      GROUP BY
        ps.id, ps.microcycle_id, ps.session_date, ps.title, ps.session_type, ps.duration_minutes,
        ps.status, ps.objective, ps.contents, ps.notes, ps.created_at, ps.updated_at,
        pm.name, pm.season_plan_id, t.name
      LIMIT 1`,
    [id],
  );

  return rows[0] ? mapSessionRow(rows[0]) : null;
}

async function listPlanSessionsByMicrocycle(microcycleId) {
  const [rows] = await db.query(
    `SELECT
        ps.*,
        pm.name AS microcycle_name,
        pm.season_plan_id,
        t.name AS team_name,
        COUNT(DISTINCT pst.id) AS task_count
      FROM plan_sessions ps
      INNER JOIN plan_microcycles pm ON pm.id = ps.microcycle_id
      INNER JOIN season_plans sp ON sp.id = pm.season_plan_id
      INNER JOIN teams t ON t.id = sp.team_id
      LEFT JOIN plan_session_tasks pst ON pst.session_id = ps.id
      WHERE ps.microcycle_id = ?
      GROUP BY
        ps.id, ps.microcycle_id, ps.session_date, ps.title, ps.session_type, ps.duration_minutes,
        ps.status, ps.objective, ps.contents, ps.notes, ps.created_at, ps.updated_at,
        pm.name, pm.season_plan_id, t.name
      ORDER BY ps.session_date ASC, ps.created_at ASC`,
    [microcycleId],
  );

  return rows.map(mapSessionRow);
}

async function updatePlanSession(id, {
  sessionDate,
  title,
  sessionType = null,
  durationMinutes = null,
  status = 'planned',
  objective = null,
  contents = null,
  notes = null,
}) {
  const [result] = await db.query(
    `UPDATE plan_sessions
     SET session_date = ?, title = ?, session_type = ?, duration_minutes = ?, status = ?, objective = ?, contents = ?, notes = ?
     WHERE id = ?`,
    [sessionDate, title, sessionType, durationMinutes, status, objective, contents, notes, id],
  );

  return result.affectedRows;
}

async function deletePlanSession(id) {
  const [result] = await db.query('DELETE FROM plan_sessions WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createPlanSessionsTable,
  createPlanSession,
  findPlanSessionById,
  listPlanSessionsByMicrocycle,
  updatePlanSession,
  deletePlanSession,
};
