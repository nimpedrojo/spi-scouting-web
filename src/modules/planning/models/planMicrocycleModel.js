const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createPlanMicrocyclesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS plan_microcycles (
      id CHAR(36) PRIMARY KEY,
      season_plan_id CHAR(36) NOT NULL,
      name VARCHAR(150) NOT NULL,
      order_index INT NOT NULL DEFAULT 1,
      start_date DATE NULL,
      end_date DATE NULL,
      objective TEXT NULL,
      phase VARCHAR(100) NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_plan_microcycles_plan_order (season_plan_id, order_index),
      CONSTRAINT fk_plan_microcycles_season_plan
        FOREIGN KEY (season_plan_id) REFERENCES season_plans(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(sql);
}

function mapMicrocycleRow(row) {
  return {
    id: row.id,
    season_plan_id: row.season_plan_id,
    name: row.name,
    order_index: Number(row.order_index || 0),
    start_date: row.start_date,
    end_date: row.end_date,
    objective: row.objective,
    phase: row.phase,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    session_count: Number(row.session_count || 0),
    season_plan_team_id: row.season_plan_team_id,
    season_label: row.season_label,
    team_name: row.team_name,
  };
}

async function createPlanMicrocycle({
  seasonPlanId,
  name,
  orderIndex,
  startDate = null,
  endDate = null,
  objective = null,
  phase = null,
  notes = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO plan_microcycles (
      id, season_plan_id, name, order_index, start_date, end_date, objective, phase, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, seasonPlanId, name, orderIndex, startDate, endDate, objective, phase, notes],
  );

  return findPlanMicrocycleById(id);
}

async function findPlanMicrocycleById(id) {
  const [rows] = await db.query(
    `SELECT
        pm.*,
        sp.team_id AS season_plan_team_id,
        sp.season_label,
        t.name AS team_name,
        COUNT(DISTINCT ps.id) AS session_count
      FROM plan_microcycles pm
      INNER JOIN season_plans sp ON sp.id = pm.season_plan_id
      INNER JOIN teams t ON t.id = sp.team_id
      LEFT JOIN plan_sessions ps ON ps.microcycle_id = pm.id
      WHERE pm.id = ?
      GROUP BY
        pm.id, pm.season_plan_id, pm.name, pm.order_index, pm.start_date, pm.end_date,
        pm.objective, pm.phase, pm.notes, pm.created_at, pm.updated_at,
        sp.team_id, sp.season_label, t.name
      LIMIT 1`,
    [id],
  );

  return rows[0] ? mapMicrocycleRow(rows[0]) : null;
}

async function listPlanMicrocyclesBySeasonPlan(seasonPlanId) {
  const [rows] = await db.query(
    `SELECT
        pm.*,
        sp.team_id AS season_plan_team_id,
        sp.season_label,
        t.name AS team_name,
        COUNT(DISTINCT ps.id) AS session_count
      FROM plan_microcycles pm
      INNER JOIN season_plans sp ON sp.id = pm.season_plan_id
      INNER JOIN teams t ON t.id = sp.team_id
      LEFT JOIN plan_sessions ps ON ps.microcycle_id = pm.id
      WHERE pm.season_plan_id = ?
      GROUP BY
        pm.id, pm.season_plan_id, pm.name, pm.order_index, pm.start_date, pm.end_date,
        pm.objective, pm.phase, pm.notes, pm.created_at, pm.updated_at,
        sp.team_id, sp.season_label, t.name
      ORDER BY pm.order_index ASC, pm.start_date ASC, pm.created_at ASC`,
    [seasonPlanId],
  );

  return rows.map(mapMicrocycleRow);
}

async function updatePlanMicrocycle(id, {
  name,
  orderIndex,
  startDate = null,
  endDate = null,
  objective = null,
  phase = null,
  notes = null,
}) {
  const [result] = await db.query(
    `UPDATE plan_microcycles
     SET name = ?, order_index = ?, start_date = ?, end_date = ?, objective = ?, phase = ?, notes = ?
     WHERE id = ?`,
    [name, orderIndex, startDate, endDate, objective, phase, notes, id],
  );

  return result.affectedRows;
}

async function deletePlanMicrocycle(id) {
  const [result] = await db.query('DELETE FROM plan_microcycles WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createPlanMicrocyclesTable,
  createPlanMicrocycle,
  findPlanMicrocycleById,
  listPlanMicrocyclesBySeasonPlan,
  updatePlanMicrocycle,
  deletePlanMicrocycle,
};
