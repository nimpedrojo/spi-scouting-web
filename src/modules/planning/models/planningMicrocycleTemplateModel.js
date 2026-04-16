const { randomUUID } = require('crypto');
const db = require('../../../db');

async function createPlanningMicrocycleTemplatesTable() {
  const templateSql = `
    CREATE TABLE IF NOT EXISTS planning_microcycle_templates (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      team_id CHAR(36) NOT NULL,
      name VARCHAR(150) NOT NULL,
      phase VARCHAR(100) NULL,
      objective TEXT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_planning_microcycle_templates_team (club_id, team_id),
      CONSTRAINT fk_planning_microcycle_templates_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_planning_microcycle_templates_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_planning_microcycle_templates_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const sessionSql = `
    CREATE TABLE IF NOT EXISTS planning_microcycle_template_sessions (
      id CHAR(36) PRIMARY KEY,
      template_id CHAR(36) NOT NULL,
      day_offset INT NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 1,
      title VARCHAR(150) NOT NULL,
      session_type VARCHAR(100) NULL,
      duration_minutes INT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'planned',
      objective TEXT NULL,
      contents TEXT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_planning_microcycle_template_sessions_template (template_id, sort_order),
      CONSTRAINT fk_planning_microcycle_template_sessions_template
        FOREIGN KEY (template_id) REFERENCES planning_microcycle_templates(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const sessionTaskSql = `
    CREATE TABLE IF NOT EXISTS planning_microcycle_template_session_tasks (
      id CHAR(36) PRIMARY KEY,
      template_session_id CHAR(36) NOT NULL,
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
      KEY idx_planning_microcycle_template_session_tasks_session (template_session_id, sort_order),
      CONSTRAINT fk_planning_microcycle_template_session_tasks_session
        FOREIGN KEY (template_session_id) REFERENCES planning_microcycle_template_sessions(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(templateSql);
  await db.query(sessionSql);
  await db.query(sessionTaskSql);

  try {
    await db.query(
      "ALTER TABLE planning_microcycle_template_sessions ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'planned'",
    );
  } catch (error) {
    if (error && error.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding planning template session status column', error);
    }
  }

  const taskAlterStatements = [
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN details TEXT NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN space VARCHAR(150) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN age_group VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN player_count INT NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN complexity VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN strategy VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN coordinative_skills VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN tactical_intention VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN dynamics VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN game_situation VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN coordination VARCHAR(100) NULL',
    'ALTER TABLE planning_microcycle_template_session_tasks ADD COLUMN explanatory_image_path VARCHAR(255) NULL',
  ];

  for (const statement of taskAlterStatements) {
    try {
      await db.query(statement);
    } catch (error) {
      if (error && error.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error alterando planning_microcycle_template_session_tasks:', error);
      }
    }
  }
}

function mapTemplateRow(row) {
  return {
    id: row.id,
    club_id: row.club_id,
    team_id: row.team_id,
    name: row.name,
    phase: row.phase,
    objective: row.objective,
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    team_name: row.team_name,
    author_name: row.author_name,
    session_blueprint_count: Number(row.session_blueprint_count || 0),
  };
}

function mapTemplateSessionRow(row) {
  return {
    id: row.id,
    template_id: row.template_id,
    day_offset: Number(row.day_offset || 0),
    sort_order: Number(row.sort_order || 0),
    title: row.title,
    session_type: row.session_type,
    duration_minutes: row.duration_minutes !== null ? Number(row.duration_minutes) : null,
    status: row.status || 'planned',
    objective: row.objective,
    contents: row.contents,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTemplateSessionTaskRow(row) {
  return {
    id: row.id,
    template_session_id: row.template_session_id,
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
  };
}

async function createPlanningMicrocycleTemplate({
  clubId,
  teamId,
  name,
  phase = null,
  objective = null,
  notes = null,
  createdBy = null,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO planning_microcycle_templates (
      id, club_id, team_id, name, phase, objective, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, clubId, teamId, name, phase, objective, notes, createdBy],
  );

  return findPlanningMicrocycleTemplateById(id);
}

async function createPlanningMicrocycleTemplateSession({
  templateId,
  dayOffset = 0,
  sortOrder = 1,
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
    `INSERT INTO planning_microcycle_template_sessions (
      id, template_id, day_offset, sort_order, title, session_type, duration_minutes, status,
      objective, contents, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      templateId,
      dayOffset,
      sortOrder,
      title,
      sessionType,
      durationMinutes,
      status,
      objective,
      contents,
      notes,
    ],
  );

  return id;
}

async function createPlanningMicrocycleTemplateSessionTask({
  templateSessionId,
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
  await db.query(
    `INSERT INTO planning_microcycle_template_session_tasks (
      id, template_session_id, sort_order, title, task_type, duration_minutes, objective, details,
      space, age_group, player_count, complexity, strategy, coordinative_skills, tactical_intention,
      dynamics, game_situation, coordination, explanatory_image_path, contents, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      templateSessionId,
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
}

async function listPlanningMicrocycleTemplatesByTeam(clubId, teamId) {
  const [rows] = await db.query(
    `SELECT
        pmt.*,
        t.name AS team_name,
        u.name AS author_name,
        COUNT(DISTINCT pmts.id) AS session_blueprint_count
      FROM planning_microcycle_templates pmt
      INNER JOIN teams t ON t.id = pmt.team_id
      LEFT JOIN users u ON u.id = pmt.created_by
      LEFT JOIN planning_microcycle_template_sessions pmts ON pmts.template_id = pmt.id
      WHERE pmt.club_id = ? AND pmt.team_id = ?
      GROUP BY
        pmt.id, pmt.club_id, pmt.team_id, pmt.name, pmt.phase, pmt.objective,
        pmt.notes, pmt.created_by, pmt.created_at, pmt.updated_at, t.name, u.name
      ORDER BY pmt.updated_at DESC, pmt.created_at DESC`,
    [clubId, teamId],
  );

  return rows.map(mapTemplateRow);
}

async function findPlanningMicrocycleTemplateById(id) {
  const [rows] = await db.query(
    `SELECT
        pmt.*,
        t.name AS team_name,
        u.name AS author_name,
        COUNT(DISTINCT pmts.id) AS session_blueprint_count
      FROM planning_microcycle_templates pmt
      INNER JOIN teams t ON t.id = pmt.team_id
      LEFT JOIN users u ON u.id = pmt.created_by
      LEFT JOIN planning_microcycle_template_sessions pmts ON pmts.template_id = pmt.id
      WHERE pmt.id = ?
      GROUP BY
        pmt.id, pmt.club_id, pmt.team_id, pmt.name, pmt.phase, pmt.objective,
        pmt.notes, pmt.created_by, pmt.created_at, pmt.updated_at, t.name, u.name
      LIMIT 1`,
    [id],
  );

  return rows[0] ? mapTemplateRow(rows[0]) : null;
}

async function listPlanningMicrocycleTemplateSessions(templateId) {
  const [rows] = await db.query(
    `SELECT *
     FROM planning_microcycle_template_sessions
     WHERE template_id = ?
     ORDER BY sort_order ASC, day_offset ASC, created_at ASC`,
    [templateId],
  );

  return rows.map(mapTemplateSessionRow);
}

async function listPlanningMicrocycleTemplateSessionTasks(templateSessionId) {
  const [rows] = await db.query(
    `SELECT *
     FROM planning_microcycle_template_session_tasks
     WHERE template_session_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [templateSessionId],
  );

  return rows.map(mapTemplateSessionTaskRow);
}

async function deletePlanningMicrocycleTemplate(id) {
  const [result] = await db.query('DELETE FROM planning_microcycle_templates WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createPlanningMicrocycleTemplatesTable,
  createPlanningMicrocycleTemplate,
  createPlanningMicrocycleTemplateSession,
  createPlanningMicrocycleTemplateSessionTask,
  listPlanningMicrocycleTemplatesByTeam,
  findPlanningMicrocycleTemplateById,
  listPlanningMicrocycleTemplateSessions,
  listPlanningMicrocycleTemplateSessionTasks,
  deletePlanningMicrocycleTemplate,
};
