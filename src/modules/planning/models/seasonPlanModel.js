const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createSeasonPlansTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS season_plans (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      team_id CHAR(36) NOT NULL,
      season_label VARCHAR(50) NOT NULL,
      planning_model VARCHAR(50) NOT NULL DEFAULT 'structured_microcycle',
      start_date DATE NULL,
      end_date DATE NULL,
      objective TEXT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_season_plans_club_team (club_id, team_id),
      KEY idx_season_plans_team_label (team_id, season_label),
      CONSTRAINT fk_season_plans_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_season_plans_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_season_plans_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(sql);
}

function mapSeasonPlanRow(row) {
  return {
    id: row.id,
    club_id: row.club_id,
    team_id: row.team_id,
    season_label: row.season_label,
    planning_model: row.planning_model,
    start_date: row.start_date,
    end_date: row.end_date,
    objective: row.objective,
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    team_name: row.team_name,
    club_name: row.club_name,
    category_name: row.category_name,
    section_name: row.section_name,
    author_name: row.author_name,
    microcycle_count: Number(row.microcycle_count || 0),
    session_count: Number(row.session_count || 0),
  };
}

async function createSeasonPlan({
  clubId,
  teamId,
  seasonLabel,
  planningModel,
  startDate = null,
  endDate = null,
  objective = null,
  notes = null,
  createdBy = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO season_plans (
      id, club_id, team_id, season_label, planning_model, start_date, end_date,
      objective, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      clubId,
      teamId,
      seasonLabel,
      planningModel,
      startDate,
      endDate,
      objective,
      notes,
      createdBy,
    ],
  );

  return findSeasonPlanById(id);
}

async function findSeasonPlanById(id) {
  const [rows] = await db.query(
    `SELECT
        sp.*,
        t.name AS team_name,
        c.name AS club_name,
        cat.name AS category_name,
        sec.name AS section_name,
        u.name AS author_name,
        COUNT(DISTINCT pm.id) AS microcycle_count,
        COUNT(DISTINCT ps.id) AS session_count
      FROM season_plans sp
      INNER JOIN teams t ON t.id = sp.team_id
      INNER JOIN clubs c ON c.id = sp.club_id
      INNER JOIN categories cat ON cat.id = t.category_id
      INNER JOIN sections sec ON sec.id = t.section_id
      LEFT JOIN users u ON u.id = sp.created_by
      LEFT JOIN plan_microcycles pm ON pm.season_plan_id = sp.id
      LEFT JOIN plan_sessions ps ON ps.microcycle_id = pm.id
      WHERE sp.id = ?
      GROUP BY
        sp.id, sp.club_id, sp.team_id, sp.season_label, sp.planning_model,
        sp.start_date, sp.end_date, sp.objective, sp.notes, sp.created_by,
        sp.created_at, sp.updated_at, t.name, c.name, cat.name, sec.name, u.name
      LIMIT 1`,
    [id],
  );

  return rows[0] ? mapSeasonPlanRow(rows[0]) : null;
}

async function listSeasonPlansByTeam(clubId, teamId) {
  const [rows] = await db.query(
    `SELECT
        sp.*,
        t.name AS team_name,
        c.name AS club_name,
        cat.name AS category_name,
        sec.name AS section_name,
        u.name AS author_name,
        COUNT(DISTINCT pm.id) AS microcycle_count,
        COUNT(DISTINCT ps.id) AS session_count
      FROM season_plans sp
      INNER JOIN teams t ON t.id = sp.team_id
      INNER JOIN clubs c ON c.id = sp.club_id
      INNER JOIN categories cat ON cat.id = t.category_id
      INNER JOIN sections sec ON sec.id = t.section_id
      LEFT JOIN users u ON u.id = sp.created_by
      LEFT JOIN plan_microcycles pm ON pm.season_plan_id = sp.id
      LEFT JOIN plan_sessions ps ON ps.microcycle_id = pm.id
      WHERE sp.club_id = ? AND sp.team_id = ?
      GROUP BY
        sp.id, sp.club_id, sp.team_id, sp.season_label, sp.planning_model,
        sp.start_date, sp.end_date, sp.objective, sp.notes, sp.created_by,
        sp.created_at, sp.updated_at, t.name, c.name, cat.name, sec.name, u.name
      ORDER BY sp.season_label DESC, sp.start_date DESC, sp.created_at DESC`,
    [clubId, teamId],
  );

  return rows.map(mapSeasonPlanRow);
}

async function updateSeasonPlan(id, {
  seasonLabel,
  planningModel,
  startDate = null,
  endDate = null,
  objective = null,
  notes = null,
}) {
  const [result] = await db.query(
    `UPDATE season_plans
     SET season_label = ?, planning_model = ?, start_date = ?, end_date = ?, objective = ?, notes = ?
     WHERE id = ?`,
    [seasonLabel, planningModel, startDate, endDate, objective, notes, id],
  );

  return result.affectedRows;
}

async function deleteSeasonPlan(id) {
  const [result] = await db.query('DELETE FROM season_plans WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createSeasonPlansTable,
  createSeasonPlan,
  findSeasonPlanById,
  listSeasonPlansByTeam,
  updateSeasonPlan,
  deleteSeasonPlan,
};
