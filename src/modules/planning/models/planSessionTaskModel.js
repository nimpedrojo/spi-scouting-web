const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createPlanSessionTasksTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS plan_session_tasks (
      id CHAR(36) PRIMARY KEY,
      session_id CHAR(36) NOT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      title VARCHAR(150) NOT NULL,
      task_type VARCHAR(100) NULL,
      duration_minutes INT NULL,
      objective TEXT NULL,
      details TEXT NULL,
      space VARCHAR(150) NULL,
      age_group VARCHAR(100) NULL,
      player_count INT NULL,
      complexity VARCHAR(100) NULL,
      strategy VARCHAR(100) NULL,
      coordinative_skills VARCHAR(100) NULL,
      tactical_intention VARCHAR(100) NULL,
      dynamics VARCHAR(100) NULL,
      game_situation VARCHAR(100) NULL,
      coordination VARCHAR(100) NULL,
      explanatory_image_path VARCHAR(255) NULL,
      contents TEXT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_plan_session_tasks_session (session_id, sort_order),
      CONSTRAINT fk_plan_session_tasks_session
        FOREIGN KEY (session_id) REFERENCES plan_sessions(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(sql);

  const alterStatements = [
    'ALTER TABLE plan_session_tasks ADD COLUMN details TEXT NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN space VARCHAR(150) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN age_group VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN player_count INT NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN complexity VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN strategy VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN coordinative_skills VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN tactical_intention VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN dynamics VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN game_situation VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN coordination VARCHAR(100) NULL',
    'ALTER TABLE plan_session_tasks ADD COLUMN explanatory_image_path VARCHAR(255) NULL',
  ];

  for (const statement of alterStatements) {
    try {
      await db.query(statement);
    } catch (error) {
      if (error && error.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error alterando plan_session_tasks:', error);
      }
    }
  }
}

function mapTaskRow(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    sort_order: Number(row.sort_order || 0),
    title: row.title,
    task_type: row.task_type,
    duration_minutes: row.duration_minutes !== null ? Number(row.duration_minutes) : null,
    objective: row.objective,
    details: row.details,
    space: row.space,
    age_group: row.age_group,
    player_count: row.player_count !== null ? Number(row.player_count) : null,
    complexity: row.complexity,
    strategy: row.strategy,
    coordinative_skills: row.coordinative_skills,
    tactical_intention: row.tactical_intention,
    dynamics: row.dynamics,
    game_situation: row.game_situation,
    coordination: row.coordination,
    explanatory_image_path: row.explanatory_image_path,
    contents: row.contents,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    session_title: row.session_title,
    microcycle_id: row.microcycle_id,
  };
}

async function createPlanSessionTask({
  sessionId,
  sortOrder = 1,
  title,
  taskType = null,
  durationMinutes = null,
  objective = null,
  details = null,
  space = null,
  ageGroup = null,
  playerCount = null,
  complexity = null,
  strategy = null,
  coordinativeSkills = null,
  tacticalIntention = null,
  dynamics = null,
  gameSituation = null,
  coordination = null,
  explanatoryImagePath = null,
  contents = null,
  notes = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO plan_session_tasks (
      id, session_id, sort_order, title, task_type, duration_minutes, objective, details, space,
      age_group, player_count, complexity, strategy, coordinative_skills, tactical_intention,
      dynamics, game_situation, coordination, explanatory_image_path, contents, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionId,
      sortOrder,
      title,
      taskType,
      durationMinutes,
      objective,
      details,
      space,
      ageGroup,
      playerCount,
      complexity,
      strategy,
      coordinativeSkills,
      tacticalIntention,
      dynamics,
      gameSituation,
      coordination,
      explanatoryImagePath,
      contents,
      notes,
    ],
  );

  return findPlanSessionTaskById(id);
}

async function findPlanSessionTaskById(id) {
  const [rows] = await db.query(
    `SELECT
        pst.*,
        ps.title AS session_title,
        ps.microcycle_id
      FROM plan_session_tasks pst
      INNER JOIN plan_sessions ps ON ps.id = pst.session_id
      WHERE pst.id = ?
      LIMIT 1`,
    [id],
  );

  return rows[0] ? mapTaskRow(rows[0]) : null;
}

async function listPlanSessionTasksBySession(sessionId) {
  const [rows] = await db.query(
    `SELECT
        pst.*,
        ps.title AS session_title,
        ps.microcycle_id
      FROM plan_session_tasks pst
      INNER JOIN plan_sessions ps ON ps.id = pst.session_id
      WHERE pst.session_id = ?
      ORDER BY pst.sort_order ASC, pst.created_at ASC`,
    [sessionId],
  );

  return rows.map(mapTaskRow);
}

async function updatePlanSessionTask(id, {
  sortOrder = 1,
  title,
  taskType = null,
  durationMinutes = null,
  objective = null,
  details = null,
  space = null,
  ageGroup = null,
  playerCount = null,
  complexity = null,
  strategy = null,
  coordinativeSkills = null,
  tacticalIntention = null,
  dynamics = null,
  gameSituation = null,
  coordination = null,
  explanatoryImagePath = null,
  contents = null,
  notes = null,
}) {
  const [result] = await db.query(
    `UPDATE plan_session_tasks
     SET sort_order = ?, title = ?, task_type = ?, duration_minutes = ?, objective = ?, details = ?,
         space = ?, age_group = ?, player_count = ?, complexity = ?, strategy = ?,
         coordinative_skills = ?, tactical_intention = ?, dynamics = ?, game_situation = ?,
         coordination = ?, explanatory_image_path = ?, contents = ?, notes = ?
     WHERE id = ?`,
    [
      sortOrder,
      title,
      taskType,
      durationMinutes,
      objective,
      details,
      space,
      ageGroup,
      playerCount,
      complexity,
      strategy,
      coordinativeSkills,
      tacticalIntention,
      dynamics,
      gameSituation,
      coordination,
      explanatoryImagePath,
      contents,
      notes,
      id,
    ],
  );

  return result.affectedRows;
}

async function deletePlanSessionTask(id) {
  const [result] = await db.query('DELETE FROM plan_session_tasks WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createPlanSessionTasksTable,
  createPlanSessionTask,
  findPlanSessionTaskById,
  listPlanSessionTasksBySession,
  updatePlanSessionTask,
  deletePlanSessionTask,
};
