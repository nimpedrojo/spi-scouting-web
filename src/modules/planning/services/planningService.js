const { getTeamsByClubId, findTeamById } = require('../../../models/teamModel');
const { getActiveSeasonByClub } = require('../../../services/teamService');
const {
  filterTeamsForUser,
  getActiveTeamScope,
  canAccessTeam,
} = require('../../../services/userScopeService');
const {
  createSeasonPlan,
  findSeasonPlanById,
  listSeasonPlansByTeam,
  updateSeasonPlan,
  deleteSeasonPlan,
} = require('../models/seasonPlanModel');
const {
  createPlanMicrocycle,
  findPlanMicrocycleById,
  listPlanMicrocyclesBySeasonPlan,
  updatePlanMicrocycle,
  deletePlanMicrocycle,
} = require('../models/planMicrocycleModel');
const {
  createPlanSession,
  findPlanSessionById,
  listPlanSessionsByMicrocycle,
  updatePlanSession,
  deletePlanSession,
} = require('../models/planSessionModel');
const {
  createPlanSessionTask,
  findPlanSessionTaskById,
  listPlanSessionTasksBySession,
  updatePlanSessionTask,
  deletePlanSessionTask,
} = require('../models/planSessionTaskModel');
const {
  createPlanningMicrocycleTemplate,
  createPlanningMicrocycleTemplateSession,
  createPlanningMicrocycleTemplateSessionTask,
  listPlanningMicrocycleTemplatesByTeam,
  findPlanningMicrocycleTemplateById,
  listPlanningMicrocycleTemplateSessions,
  listPlanningMicrocycleTemplateSessionTasks,
  deletePlanningMicrocycleTemplate,
} = require('../models/planningMicrocycleTemplateModel');
const { clonePlanningTaskImage } = require('./planningTaskAssetService');

const PLANNING_MODELS = [
  {
    key: 'structured_microcycle',
    label: 'Structured microcycle',
  },
  {
    key: 'periodization',
    label: 'Periodization',
  },
];

const MICRO_PHASES = [
  'Acumulacion',
  'Transformacion',
  'Competicion',
  'Recuperacion',
];

const SESSION_TYPES = [
  'Entrenamiento de campo',
  'Gimnasio',
  'Recuperacion',
  'Partido',
  'Analisis',
];

const TASK_TYPES = [
  'Activacion',
  'Tecnica',
  'Tactica',
  'Juego reducido',
  'Partido condicionado',
  'Finalizacion',
  'Recuperacion',
  'Analisis',
];

const TASK_COMPLEXITY_OPTIONS = [
  'Baja',
  'Media',
  'Alta',
];

const TASK_STRATEGY_OPTIONS = [
  'Individual',
  'Grupal',
  'Colectiva',
];

const TASK_COORDINATIVE_SKILLS_OPTIONS = [
  'Orientacion',
  'Ritmo',
  'Equilibrio',
  'Reaccion',
  'Diferenciacion',
  'Acoplamiento',
];

const TASK_TACTICAL_INTENTION_OPTIONS = [
  'Conservar',
  'Progresar',
  'Finalizar',
  'Presionar',
  'Defender area',
  'Transicion',
];

const TASK_DYNAMICS_OPTIONS = [
  'Analitica',
  'Integrada',
  'Competitiva',
];

const TASK_GAME_SITUATION_OPTIONS = [
  'Sin oposicion',
  'Con oposicion',
  'Superioridad',
  'Igualdad',
  'Inferioridad',
];

const TASK_COORDINATION_OPTIONS = [
  'General',
  'Especifica',
  'Neuromuscular',
];

const SESSION_STATUS_OPTIONS = [
  { key: 'planned', label: 'Planificada', badgeClass: 'text-bg-primary' },
  { key: 'done', label: 'Realizada', badgeClass: 'text-bg-success' },
  { key: 'cancelled', label: 'Cancelada', badgeClass: 'text-bg-secondary' },
];

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeDate(value) {
  const normalized = normalizeOptionalText(value);
  return normalized || null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function normalizeStatus(value) {
  const normalized = normalizeOptionalText(value) || 'planned';
  if (!SESSION_STATUS_OPTIONS.find((option) => option.key === normalized)) {
    return 'planned';
  }
  return normalized;
}

function getSessionStatusMeta(status) {
  return SESSION_STATUS_OPTIONS.find((option) => option.key === status)
    || SESSION_STATUS_OPTIONS[0];
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function parseIsoDateToUtc(value) {
  const isoDate = toIsoDate(value);
  if (!isoDate) {
    return null;
  }

  return new Date(`${isoDate}T00:00:00.000Z`);
}

function addDaysToIsoDate(baseDate, offsetDays) {
  const parsedBase = parseIsoDateToUtc(baseDate);
  if (!parsedBase) {
    return null;
  }

  parsedBase.setUTCDate(parsedBase.getUTCDate() + Number(offsetDays || 0));
  return parsedBase.toISOString().slice(0, 10);
}

function diffDays(fromDate, toDate) {
  const from = parseIsoDateToUtc(fromDate);
  const to = parseIsoDateToUtc(toDate);
  if (!from || !to) {
    return 0;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / millisecondsPerDay);
}

function getDateLabel(dateValue) {
  const isoDate = toIsoDate(dateValue);
  if (!isoDate) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(parseIsoDateToUtc(isoDate));
}

function decorateSession(session) {
  const statusMeta = getSessionStatusMeta(session.status);
  return {
    ...session,
    session_date_iso: toIsoDate(session.session_date),
    status_meta: statusMeta,
  };
}

function decorateTask(task) {
  return {
    ...task,
  };
}

function buildWeeklyView(sessions) {
  const grouped = new Map();

  sessions.forEach((session) => {
    const isoDate = session.session_date_iso || toIsoDate(session.session_date) || 'sin-fecha';
    if (!grouped.has(isoDate)) {
      grouped.set(isoDate, {
        isoDate,
        label: getDateLabel(isoDate),
        sessions: [],
      });
    }

    grouped.get(isoDate).sessions.push(session);
  });

  return [...grouped.values()];
}

function buildSessionStatusSummary(sessions) {
  return SESSION_STATUS_OPTIONS.map((statusOption) => ({
    ...statusOption,
    count: sessions.filter((session) => session.status === statusOption.key).length,
  }));
}

function decorateSeasonPlan(seasonPlan) {
  return {
    ...seasonPlan,
    start_date_iso: toIsoDate(seasonPlan.start_date),
    end_date_iso: toIsoDate(seasonPlan.end_date),
  };
}

function decorateMicrocycle(microcycle) {
  return {
    ...microcycle,
    start_date_iso: toIsoDate(microcycle.start_date),
    end_date_iso: toIsoDate(microcycle.end_date),
  };
}

async function getVisibleTeamsForPlanning(user, clubId) {
  const teams = await getTeamsByClubId(clubId);
  return filterTeamsForUser(user, teams);
}

async function resolveSelectedTeam(user, clubId, requestedTeamId = null) {
  const visibleTeams = await getVisibleTeamsForPlanning(user, clubId);
  if (!visibleTeams.length) {
    return {
      visibleTeams,
      selectedTeam: null,
    };
  }

  if (requestedTeamId) {
    const requested = visibleTeams.find((team) => String(team.id) === String(requestedTeamId));
    if (requested) {
      return {
        visibleTeams,
        selectedTeam: requested,
      };
    }
  }

  const activeTeamScope = await getActiveTeamScope(user);
  if (activeTeamScope) {
    const scoped = visibleTeams.find((team) => String(team.id) === String(activeTeamScope.id));
    if (scoped) {
      return {
        visibleTeams,
        selectedTeam: scoped,
      };
    }
  }

  return {
    visibleTeams,
    selectedTeam: visibleTeams[0],
  };
}

async function getPlanningHomeData(user, club, activeSeason, requestedTeamId = null) {
  const { visibleTeams, selectedTeam } = await resolveSelectedTeam(user, club.id, requestedTeamId);
  const seasonPlans = selectedTeam
    ? (await listSeasonPlansByTeam(club.id, selectedTeam.id)).map(decorateSeasonPlan)
    : [];

  return {
    visibleTeams,
    selectedTeam,
    activeSeason,
    seasonPlans,
    canManagePlanning: Boolean(user),
  };
}

async function assertAccessibleTeam(user, clubId, teamId) {
  const team = await findTeamById(teamId);
  if (!team || Number(team.club_id) !== Number(clubId)) {
    return null;
  }

  if (!(await canAccessTeam(user, teamId))) {
    return null;
  }

  return team;
}

async function getSeasonPlanContextForUser(user, clubId, seasonPlanId) {
  const seasonPlan = await findSeasonPlanById(seasonPlanId);
  if (!seasonPlan || Number(seasonPlan.club_id) !== Number(clubId)) {
    return null;
  }

  if (!(await canAccessTeam(user, seasonPlan.team_id))) {
    return null;
  }

  return decorateSeasonPlan(seasonPlan);
}

async function getPlanningMicrocycleTemplateForUser(user, clubId, templateId) {
  const template = await findPlanningMicrocycleTemplateById(templateId);
  if (!template || Number(template.club_id) !== Number(clubId)) {
    return null;
  }

  if (!(await canAccessTeam(user, template.team_id))) {
    return null;
  }

  const sessions = await listPlanningMicrocycleTemplateSessions(template.id);
  return {
    template,
    sessions,
  };
}

async function getSeasonPlanDetailForUser(user, clubId, seasonPlanId) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, seasonPlanId);
  if (!seasonPlan) {
    return null;
  }

  const [microcycles, templates] = await Promise.all([
    listPlanMicrocyclesBySeasonPlan(seasonPlan.id),
    listPlanningMicrocycleTemplatesByTeam(clubId, seasonPlan.team_id),
  ]);

  return {
    seasonPlan,
    microcycles: microcycles.map(decorateMicrocycle),
    templates,
  };
}

async function getMicrocycleDetailForUser(user, clubId, microcycleId) {
  const microcycle = await findPlanMicrocycleById(microcycleId);
  if (!microcycle) {
    return null;
  }

  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, microcycle.season_plan_id);
  if (!seasonPlan) {
    return null;
  }

  const sessions = (await listPlanSessionsByMicrocycle(microcycle.id)).map(decorateSession);

  return {
    seasonPlan,
    microcycle: decorateMicrocycle(microcycle),
    sessions,
    weeklyView: buildWeeklyView(sessions),
    statusSummary: buildSessionStatusSummary(sessions),
  };
}

async function getSessionDetailForUser(user, clubId, sessionId) {
  const session = await findPlanSessionById(sessionId);
  if (!session) {
    return null;
  }

  const microcycleDetail = await getMicrocycleDetailForUser(user, clubId, session.microcycle_id);
  if (!microcycleDetail) {
    return null;
  }

  const resolvedSession = microcycleDetail.sessions.find((entry) => String(entry.id) === String(sessionId))
    || decorateSession(session);
  const tasks = (await listPlanSessionTasksBySession(sessionId)).map(decorateTask);

  return {
    seasonPlan: microcycleDetail.seasonPlan,
    microcycle: microcycleDetail.microcycle,
    session: resolvedSession,
    tasks,
  };
}

async function getSeasonPlanFormData(user, club, requestedTeamId = null) {
  const { visibleTeams, selectedTeam } = await resolveSelectedTeam(user, club.id, requestedTeamId);
  const activeSeason = await getActiveSeasonByClub(club.id);

  return {
    visibleTeams,
    selectedTeam,
    activeSeason,
    planningModels: PLANNING_MODELS,
  };
}

async function getMicrocycleFormDataForUser(user, clubId, seasonPlanId, templateId = null) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, seasonPlanId);
  if (!seasonPlan) {
    return null;
  }

  const templates = await listPlanningMicrocycleTemplatesByTeam(clubId, seasonPlan.team_id);
  let selectedTemplate = null;

  if (templateId) {
    const templateDetail = await getPlanningMicrocycleTemplateForUser(user, clubId, templateId);
    if (templateDetail && String(templateDetail.template.team_id) === String(seasonPlan.team_id)) {
      selectedTemplate = templateDetail;
    }
  }

  return {
    seasonPlan,
    templates,
    selectedTemplate,
  };
}

function validateSeasonPlanPayload(payload) {
  const errors = [];

  if (!payload.seasonLabel) {
    errors.push('La etiqueta de temporada es obligatoria.');
  }
  if (!payload.planningModel) {
    errors.push('El modelo de planificación es obligatorio.');
  }
  if (payload.startDate && payload.endDate && payload.startDate > payload.endDate) {
    errors.push('La fecha de inicio no puede ser posterior a la fecha de fin.');
  }

  return errors;
}

function validateMicrocyclePayload(payload) {
  const errors = [];

  if (!payload.name) {
    errors.push('El nombre del microciclo es obligatorio.');
  }
  if (!Number.isInteger(payload.orderIndex) || payload.orderIndex < 1) {
    errors.push('El orden del microciclo debe ser un entero positivo.');
  }
  if (payload.startDate && payload.endDate && payload.startDate > payload.endDate) {
    errors.push('La fecha de inicio no puede ser posterior a la fecha de fin.');
  }

  return errors;
}

function validateSessionPayload(payload) {
  const errors = [];

  if (!payload.sessionDate) {
    errors.push('La fecha de la sesión es obligatoria.');
  }
  if (!payload.title) {
    errors.push('El título de la sesión es obligatorio.');
  }
  if (payload.durationMinutes === null && normalizeOptionalText(payload.durationMinutesRaw)) {
    errors.push('La duración debe ser un número entero positivo.');
  }

  return errors;
}

function validateTemplatePayload(payload) {
  const errors = [];

  if (!payload.sourceMicrocycleId) {
    errors.push('Selecciona un microciclo válido para guardar la plantilla.');
  }
  if (!payload.name) {
    errors.push('El nombre de la plantilla es obligatorio.');
  }

  return errors;
}

function validateTaskPayload(payload) {
  const errors = [];

  if (!payload.sessionId) {
    errors.push('La sesión seleccionada no es válida.');
  }
  if (!payload.title) {
    errors.push('El título de la tarea es obligatorio.');
  }
  if (!Number.isInteger(payload.sortOrder) || payload.sortOrder < 1) {
    errors.push('El orden de la tarea debe ser un entero positivo.');
  }
  if (payload.durationMinutes === null && normalizeOptionalText(payload.durationMinutesRaw)) {
    errors.push('La duración de la tarea debe ser un número entero positivo.');
  }
  if (payload.playerCount === null && normalizeOptionalText(payload.playerCountRaw)) {
    errors.push('El número de jugadores debe ser un número entero positivo.');
  }

  return errors;
}

async function createSeasonPlanForUser(user, clubId, payload) {
  const team = await assertAccessibleTeam(user, clubId, payload.teamId);
  if (!team) {
    return { errors: ['El equipo seleccionado no es válido para tu contexto.'] };
  }

  const errors = validateSeasonPlanPayload(payload);
  if (errors.length) {
    return { errors };
  }

  const seasonPlan = await createSeasonPlan({
    clubId,
    teamId: team.id,
    seasonLabel: payload.seasonLabel,
    planningModel: payload.planningModel,
    startDate: payload.startDate,
    endDate: payload.endDate,
    objective: payload.objective,
    notes: payload.notes,
    createdBy: user ? user.id : null,
  });

  return { seasonPlan };
}

async function updateSeasonPlanForUser(user, clubId, seasonPlanId, payload) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, seasonPlanId);
  if (!seasonPlan) {
    return { errors: ['Planificación no encontrada.'] };
  }

  const errors = validateSeasonPlanPayload(payload);
  if (errors.length) {
    return { errors };
  }

  await updateSeasonPlan(seasonPlan.id, {
    seasonLabel: payload.seasonLabel,
    planningModel: payload.planningModel,
    startDate: payload.startDate,
    endDate: payload.endDate,
    objective: payload.objective,
    notes: payload.notes,
  });

  return { seasonPlan: await findSeasonPlanById(seasonPlan.id) };
}

async function deleteSeasonPlanForUser(user, clubId, seasonPlanId) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, seasonPlanId);
  if (!seasonPlan) {
    return null;
  }

  await deleteSeasonPlan(seasonPlan.id);
  return seasonPlan;
}

async function getNextMicrocycleOrderIndex(seasonPlanId) {
  const microcycles = await listPlanMicrocyclesBySeasonPlan(seasonPlanId);
  return microcycles.reduce((maxOrder, microcycle) => Math.max(maxOrder, microcycle.order_index || 0), 0) + 1;
}

async function createSessionsFromTemplate(microcycleId, startDate, templateSessions) {
  for (const templateSession of templateSessions) {
    const createdSession = await createPlanSession({
      microcycleId,
      sessionDate: addDaysToIsoDate(startDate, templateSession.day_offset),
      title: templateSession.title,
      sessionType: templateSession.session_type,
      durationMinutes: templateSession.duration_minutes,
      status: templateSession.status,
      objective: templateSession.objective,
      contents: templateSession.contents,
      notes: templateSession.notes,
    });

    const templateTasks = await listPlanningMicrocycleTemplateSessionTasks(templateSession.id);
    for (const templateTask of templateTasks) {
      await createPlanSessionTask({
        sessionId: createdSession.id,
        sortOrder: templateTask.sort_order,
        title: templateTask.title,
        taskType: templateTask.task_type,
        durationMinutes: templateTask.duration_minutes,
        objective: templateTask.objective,
        details: templateTask.details,
        space: templateTask.space,
        ageGroup: templateTask.age_group,
        playerCount: templateTask.player_count,
        complexity: templateTask.complexity,
        strategy: templateTask.strategy,
        coordinativeSkills: templateTask.coordinative_skills,
        tacticalIntention: templateTask.tactical_intention,
        dynamics: templateTask.dynamics,
        gameSituation: templateTask.game_situation,
        coordination: templateTask.coordination,
        explanatoryImagePath: await clonePlanningTaskImage(templateTask.explanatory_image_path),
        contents: templateTask.contents,
        notes: templateTask.notes,
      });
    }
  }
}

async function createMicrocycleForUser(user, clubId, payload) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, payload.seasonPlanId);
  if (!seasonPlan) {
    return { errors: ['La planificación seleccionada no es válida.'] };
  }

  let templateDetail = null;
  if (payload.templateId) {
    templateDetail = await getPlanningMicrocycleTemplateForUser(user, clubId, payload.templateId);
    if (!templateDetail || String(templateDetail.template.team_id) !== String(seasonPlan.team_id)) {
      return { errors: ['La plantilla seleccionada no es válida para este equipo.'] };
    }
  }

  const resolvedPayload = {
    ...payload,
    name: payload.name || (templateDetail ? templateDetail.template.name : null),
    phase: payload.phase || (templateDetail ? templateDetail.template.phase : null),
    objective: payload.objective || (templateDetail ? templateDetail.template.objective : null),
    notes: payload.notes || (templateDetail ? templateDetail.template.notes : null),
  };

  const errors = validateMicrocyclePayload(resolvedPayload);
  if (!errors.length && templateDetail && templateDetail.sessions.length && !resolvedPayload.startDate) {
    errors.push('Indica una fecha de inicio para crear sesiones base desde la plantilla.');
  }
  if (errors.length) {
    return { errors };
  }

  const microcycle = await createPlanMicrocycle({
    seasonPlanId: seasonPlan.id,
    name: resolvedPayload.name,
    orderIndex: resolvedPayload.orderIndex,
    startDate: resolvedPayload.startDate,
    endDate: resolvedPayload.endDate,
    objective: resolvedPayload.objective,
    phase: resolvedPayload.phase,
    notes: resolvedPayload.notes,
  });

  if (templateDetail && templateDetail.sessions.length) {
    await createSessionsFromTemplate(microcycle.id, resolvedPayload.startDate, templateDetail.sessions);
  }

  return { seasonPlan, microcycle: await findPlanMicrocycleById(microcycle.id) };
}

async function updateMicrocycleForUser(user, clubId, microcycleId, payload) {
  const detail = await getMicrocycleDetailForUser(user, clubId, microcycleId);
  if (!detail) {
    return { errors: ['Microciclo no encontrado.'] };
  }

  const errors = validateMicrocyclePayload(payload);
  if (errors.length) {
    return { errors };
  }

  await updatePlanMicrocycle(detail.microcycle.id, {
    name: payload.name,
    orderIndex: payload.orderIndex,
    startDate: payload.startDate,
    endDate: payload.endDate,
    objective: payload.objective,
    phase: payload.phase,
    notes: payload.notes,
  });

  return {
    seasonPlan: detail.seasonPlan,
    microcycle: await findPlanMicrocycleById(detail.microcycle.id),
  };
}

async function duplicateMicrocycleForUser(user, clubId, microcycleId) {
  const detail = await getMicrocycleDetailForUser(user, clubId, microcycleId);
  if (!detail) {
    return { errors: ['Microciclo no encontrado.'] };
  }

  const duplicatedMicrocycle = await createPlanMicrocycle({
    seasonPlanId: detail.seasonPlan.id,
    name: `${detail.microcycle.name} (copia)`,
    orderIndex: await getNextMicrocycleOrderIndex(detail.seasonPlan.id),
    startDate: toIsoDate(detail.microcycle.start_date),
    endDate: toIsoDate(detail.microcycle.end_date),
    objective: detail.microcycle.objective,
    phase: detail.microcycle.phase,
    notes: detail.microcycle.notes,
  });

  for (const session of detail.sessions) {
    const duplicatedSession = await createPlanSession({
      microcycleId: duplicatedMicrocycle.id,
      sessionDate: session.session_date_iso,
      title: session.title,
      sessionType: session.session_type,
      durationMinutes: session.duration_minutes,
      status: session.status,
      objective: session.objective,
      contents: session.contents,
      notes: session.notes,
    });

    const sourceTasks = await listPlanSessionTasksBySession(session.id);
    for (const task of sourceTasks) {
      await createPlanSessionTask({
        sessionId: duplicatedSession.id,
        sortOrder: task.sort_order,
        title: task.title,
        taskType: task.task_type,
        durationMinutes: task.duration_minutes,
        objective: task.objective,
        details: task.details,
        space: task.space,
        ageGroup: task.age_group,
        playerCount: task.player_count,
        complexity: task.complexity,
        strategy: task.strategy,
        coordinativeSkills: task.coordinative_skills,
        tacticalIntention: task.tactical_intention,
        dynamics: task.dynamics,
        gameSituation: task.game_situation,
        coordination: task.coordination,
        explanatoryImagePath: await clonePlanningTaskImage(task.explanatory_image_path),
        contents: task.contents,
        notes: task.notes,
      });
    }
  }

  return {
    seasonPlan: detail.seasonPlan,
    microcycle: await findPlanMicrocycleById(duplicatedMicrocycle.id),
  };
}

async function deleteMicrocycleForUser(user, clubId, microcycleId) {
  const detail = await getMicrocycleDetailForUser(user, clubId, microcycleId);
  if (!detail) {
    return null;
  }

  await deletePlanMicrocycle(detail.microcycle.id);
  return detail;
}

async function createSessionForUser(user, clubId, payload) {
  const detail = await getMicrocycleDetailForUser(user, clubId, payload.microcycleId);
  if (!detail) {
    return { errors: ['El microciclo seleccionado no es válido.'] };
  }

  const errors = validateSessionPayload(payload);
  if (errors.length) {
    return { errors };
  }

  const session = await createPlanSession({
    microcycleId: detail.microcycle.id,
    sessionDate: payload.sessionDate,
    title: payload.title,
    sessionType: payload.sessionType,
    durationMinutes: payload.durationMinutes,
    status: payload.status,
    objective: payload.objective,
    contents: payload.contents,
    notes: payload.notes,
  });

  return {
    seasonPlan: detail.seasonPlan,
    microcycle: detail.microcycle,
    session,
  };
}

async function updateSessionForUser(user, clubId, sessionId, payload) {
  const session = await findPlanSessionById(sessionId);
  if (!session) {
    return { errors: ['Sesión no encontrada.'] };
  }

  const detail = await getMicrocycleDetailForUser(user, clubId, session.microcycle_id);
  if (!detail) {
    return { errors: ['Sesión no encontrada.'] };
  }

  const errors = validateSessionPayload(payload);
  if (errors.length) {
    return { errors };
  }

  await updatePlanSession(session.id, {
    sessionDate: payload.sessionDate,
    title: payload.title,
    sessionType: payload.sessionType,
    durationMinutes: payload.durationMinutes,
    status: payload.status,
    objective: payload.objective,
    contents: payload.contents,
    notes: payload.notes,
  });

  return {
    seasonPlan: detail.seasonPlan,
    microcycle: detail.microcycle,
    session: await findPlanSessionById(session.id),
  };
}

async function deleteSessionForUser(user, clubId, sessionId) {
  const session = await findPlanSessionById(sessionId);
  if (!session) {
    return null;
  }

  const detail = await getMicrocycleDetailForUser(user, clubId, session.microcycle_id);
  if (!detail) {
    return null;
  }

  await deletePlanSession(session.id);
  return {
    ...detail,
    session,
  };
}

async function createTaskForUser(user, clubId, payload) {
  const detail = await getSessionDetailForUser(user, clubId, payload.sessionId);
  if (!detail) {
    return { errors: ['La sesión seleccionada no es válida.'] };
  }

  const errors = validateTaskPayload(payload);
  if (errors.length) {
    return { errors };
  }

  const task = await createPlanSessionTask({
    sessionId: detail.session.id,
    sortOrder: payload.sortOrder,
    title: payload.title,
    taskType: payload.taskType,
    durationMinutes: payload.durationMinutes,
    objective: payload.objective,
    details: payload.details,
    space: payload.space,
    ageGroup: payload.ageGroup,
    playerCount: payload.playerCount,
    complexity: payload.complexity,
    strategy: payload.strategy,
    coordinativeSkills: payload.coordinativeSkills,
    tacticalIntention: payload.tacticalIntention,
    dynamics: payload.dynamics,
    gameSituation: payload.gameSituation,
    coordination: payload.coordination,
    explanatoryImagePath: payload.explanatoryImagePath,
    contents: payload.contents,
    notes: payload.notes,
  });

  return {
    ...detail,
    task,
  };
}

async function updateTaskForUser(user, clubId, taskId, payload) {
  const task = await findPlanSessionTaskById(taskId);
  if (!task) {
    return { errors: ['Tarea no encontrada.'] };
  }

  const detail = await getSessionDetailForUser(user, clubId, task.session_id);
  if (!detail) {
    return { errors: ['Tarea no encontrada.'] };
  }

  const errors = validateTaskPayload({
    ...payload,
    sessionId: task.session_id,
  });
  if (errors.length) {
    return { errors };
  }

  await updatePlanSessionTask(task.id, {
    sortOrder: payload.sortOrder,
    title: payload.title,
    taskType: payload.taskType,
    durationMinutes: payload.durationMinutes,
    objective: payload.objective,
    details: payload.details,
    space: payload.space,
    ageGroup: payload.ageGroup,
    playerCount: payload.playerCount,
    complexity: payload.complexity,
    strategy: payload.strategy,
    coordinativeSkills: payload.coordinativeSkills,
    tacticalIntention: payload.tacticalIntention,
    dynamics: payload.dynamics,
    gameSituation: payload.gameSituation,
    coordination: payload.coordination,
    explanatoryImagePath: payload.explanatoryImagePath,
    contents: payload.contents,
    notes: payload.notes,
  });

  return {
    ...detail,
    task: await findPlanSessionTaskById(task.id),
  };
}

async function deleteTaskForUser(user, clubId, taskId) {
  const task = await findPlanSessionTaskById(taskId);
  if (!task) {
    return null;
  }

  const detail = await getSessionDetailForUser(user, clubId, task.session_id);
  if (!detail) {
    return null;
  }

  await deletePlanSessionTask(task.id);
  return {
    ...detail,
    task,
  };
}

async function createMicrocycleTemplateFromUser(user, clubId, payload) {
  const errors = validateTemplatePayload(payload);
  if (errors.length) {
    return { errors };
  }

  const detail = await getMicrocycleDetailForUser(user, clubId, payload.sourceMicrocycleId);
  if (!detail) {
    return { errors: ['El microciclo seleccionado no es válido.'] };
  }

  const template = await createPlanningMicrocycleTemplate({
    clubId,
    teamId: detail.seasonPlan.team_id,
    name: payload.name,
    phase: payload.phase || detail.microcycle.phase,
    objective: payload.objective || detail.microcycle.objective,
    notes: payload.notes || detail.microcycle.notes,
    createdBy: user ? user.id : null,
  });

  for (let index = 0; index < detail.sessions.length; index += 1) {
    const session = detail.sessions[index];
    const templateSessionId = await createPlanningMicrocycleTemplateSession({
      templateId: template.id,
      dayOffset: detail.microcycle.start_date
        ? diffDays(detail.microcycle.start_date, session.session_date_iso)
        : index,
      sortOrder: index + 1,
      title: session.title,
      sessionType: session.session_type,
      durationMinutes: session.duration_minutes,
      status: session.status,
      objective: session.objective,
      contents: session.contents,
      notes: session.notes,
    });

    const sessionTasks = await listPlanSessionTasksBySession(session.id);
    for (const task of sessionTasks) {
      await createPlanningMicrocycleTemplateSessionTask({
        templateSessionId,
        sortOrder: task.sort_order,
        title: task.title,
        taskType: task.task_type,
        durationMinutes: task.duration_minutes,
        objective: task.objective,
        details: task.details,
        space: task.space,
        ageGroup: task.age_group,
        playerCount: task.player_count,
        complexity: task.complexity,
        strategy: task.strategy,
        coordinativeSkills: task.coordinative_skills,
        tacticalIntention: task.tactical_intention,
        dynamics: task.dynamics,
        gameSituation: task.game_situation,
        coordination: task.coordination,
        explanatoryImagePath: await clonePlanningTaskImage(task.explanatory_image_path),
        contents: task.contents,
        notes: task.notes,
      });
    }
  }

  return {
    detail,
    template: await findPlanningMicrocycleTemplateById(template.id),
  };
}

async function deleteMicrocycleTemplateForUser(user, clubId, templateId) {
  const detail = await getPlanningMicrocycleTemplateForUser(user, clubId, templateId);
  if (!detail) {
    return null;
  }

  await deletePlanningMicrocycleTemplate(detail.template.id);
  return detail;
}

function buildSeasonPlanFormValues(source = {}, fallback = {}) {
  return {
    team_id: source.team_id || fallback.team_id || '',
    season_label: source.season_label || fallback.season_label || '',
    planning_model: source.planning_model || fallback.planning_model || 'structured_microcycle',
    start_date: toIsoDate(source.start_date) || toIsoDate(fallback.start_date) || '',
    end_date: toIsoDate(source.end_date) || toIsoDate(fallback.end_date) || '',
    objective: source.objective || fallback.objective || '',
    notes: source.notes || fallback.notes || '',
  };
}

function buildMicrocycleFormValues(source = {}, fallback = {}) {
  return {
    season_plan_id: source.season_plan_id || fallback.season_plan_id || '',
    template_id: source.template_id || fallback.template_id || '',
    name: source.name || fallback.name || '',
    order_index: source.order_index || fallback.order_index || 1,
    start_date: toIsoDate(source.start_date) || toIsoDate(fallback.start_date) || '',
    end_date: toIsoDate(source.end_date) || toIsoDate(fallback.end_date) || '',
    objective: source.objective || fallback.objective || '',
    phase: source.phase || fallback.phase || '',
    notes: source.notes || fallback.notes || '',
  };
}

function buildSessionFormValues(source = {}, fallback = {}) {
  return {
    microcycle_id: source.microcycle_id || fallback.microcycle_id || '',
    session_date: toIsoDate(source.session_date) || toIsoDate(fallback.session_date) || '',
    title: source.title || fallback.title || '',
    session_type: source.session_type || fallback.session_type || '',
    duration_minutes: source.duration_minutes || fallback.duration_minutes || '',
    status: source.status || fallback.status || 'planned',
    objective: source.objective || fallback.objective || '',
    contents: source.contents || fallback.contents || '',
    notes: source.notes || fallback.notes || '',
  };
}

function buildTemplateFormValues(source = {}, fallback = {}) {
  return {
    source_microcycle_id: source.source_microcycle_id || fallback.source_microcycle_id || '',
    name: source.name || fallback.name || '',
    phase: source.phase || fallback.phase || '',
    objective: source.objective || fallback.objective || '',
    notes: source.notes || fallback.notes || '',
  };
}

function buildTaskFormValues(source = {}, fallback = {}) {
  return {
    session_id: source.session_id || fallback.session_id || '',
    sort_order: source.sort_order || fallback.sort_order || 1,
    title: source.title || fallback.title || '',
    task_type: source.task_type || fallback.task_type || '',
    duration_minutes: source.duration_minutes || fallback.duration_minutes || '',
    objective: source.objective || fallback.objective || '',
    details: source.details || fallback.details || source.contents || fallback.contents || '',
    space: source.space || fallback.space || '',
    age_group: source.age_group || fallback.age_group || '',
    player_count: source.player_count || fallback.player_count || '',
    complexity: source.complexity || fallback.complexity || '',
    strategy: source.strategy || fallback.strategy || '',
    coordinative_skills: source.coordinative_skills || fallback.coordinative_skills || '',
    tactical_intention: source.tactical_intention || fallback.tactical_intention || '',
    dynamics: source.dynamics || fallback.dynamics || '',
    game_situation: source.game_situation || fallback.game_situation || '',
    coordination: source.coordination || fallback.coordination || '',
    explanatory_image_path: source.explanatory_image_path || fallback.explanatory_image_path || '',
    contents: source.contents || fallback.contents || '',
    notes: source.notes || fallback.notes || '',
  };
}

function parseSeasonPlanPayload(body) {
  return {
    teamId: normalizeOptionalText(body.team_id),
    seasonLabel: normalizeOptionalText(body.season_label),
    planningModel: normalizeOptionalText(body.planning_model),
    startDate: normalizeDate(body.start_date),
    endDate: normalizeDate(body.end_date),
    objective: normalizeOptionalText(body.objective),
    notes: normalizeOptionalText(body.notes),
  };
}

function parseMicrocyclePayload(body) {
  return {
    seasonPlanId: normalizeOptionalText(body.season_plan_id),
    templateId: normalizeOptionalText(body.template_id),
    name: normalizeOptionalText(body.name),
    orderIndex: Number(body.order_index),
    startDate: normalizeDate(body.start_date),
    endDate: normalizeDate(body.end_date),
    objective: normalizeOptionalText(body.objective),
    phase: normalizeOptionalText(body.phase),
    notes: normalizeOptionalText(body.notes),
  };
}

function parseSessionPayload(body) {
  return {
    microcycleId: normalizeOptionalText(body.microcycle_id),
    sessionDate: normalizeDate(body.session_date),
    title: normalizeOptionalText(body.title),
    sessionType: normalizeOptionalText(body.session_type),
    durationMinutesRaw: body.duration_minutes,
    durationMinutes: normalizeInteger(body.duration_minutes),
    status: normalizeStatus(body.status),
    objective: normalizeOptionalText(body.objective),
    contents: normalizeOptionalText(body.contents),
    notes: normalizeOptionalText(body.notes),
  };
}

function parseTemplatePayload(body) {
  return {
    sourceMicrocycleId: normalizeOptionalText(body.source_microcycle_id),
    name: normalizeOptionalText(body.name),
    phase: normalizeOptionalText(body.phase),
    objective: normalizeOptionalText(body.objective),
    notes: normalizeOptionalText(body.notes),
  };
}

function parseTaskPayload(body) {
  return {
    sessionId: normalizeOptionalText(body.session_id),
    sortOrder: Number(body.sort_order),
    title: normalizeOptionalText(body.title),
    taskType: normalizeOptionalText(body.task_type),
    durationMinutesRaw: body.duration_minutes,
    durationMinutes: normalizeInteger(body.duration_minutes),
    objective: normalizeOptionalText(body.objective),
    details: normalizeOptionalText(body.details),
    space: normalizeOptionalText(body.space),
    ageGroup: normalizeOptionalText(body.age_group),
    playerCountRaw: body.player_count,
    playerCount: normalizeInteger(body.player_count),
    complexity: normalizeOptionalText(body.complexity),
    strategy: normalizeOptionalText(body.strategy),
    coordinativeSkills: normalizeOptionalText(body.coordinative_skills),
    tacticalIntention: normalizeOptionalText(body.tactical_intention),
    dynamics: normalizeOptionalText(body.dynamics),
    gameSituation: normalizeOptionalText(body.game_situation),
    coordination: normalizeOptionalText(body.coordination),
    explanatoryImagePath: normalizeOptionalText(body.explanatory_image_path),
    contents: normalizeOptionalText(body.contents),
    notes: normalizeOptionalText(body.notes),
  };
}

module.exports = {
  PLANNING_MODELS,
  MICRO_PHASES,
  SESSION_TYPES,
  SESSION_STATUS_OPTIONS,
  TASK_TYPES,
  TASK_COMPLEXITY_OPTIONS,
  TASK_STRATEGY_OPTIONS,
  TASK_COORDINATIVE_SKILLS_OPTIONS,
  TASK_TACTICAL_INTENTION_OPTIONS,
  TASK_DYNAMICS_OPTIONS,
  TASK_GAME_SITUATION_OPTIONS,
  TASK_COORDINATION_OPTIONS,
  getPlanningHomeData,
  getSeasonPlanFormData,
  getMicrocycleFormDataForUser,
  getSeasonPlanDetailForUser,
  getSeasonPlanContextForUser,
  getMicrocycleDetailForUser,
  getSessionDetailForUser,
  getPlanningMicrocycleTemplateForUser,
  createSeasonPlanForUser,
  updateSeasonPlanForUser,
  deleteSeasonPlanForUser,
  createMicrocycleForUser,
  updateMicrocycleForUser,
  duplicateMicrocycleForUser,
  deleteMicrocycleForUser,
  createSessionForUser,
  updateSessionForUser,
  deleteSessionForUser,
  createTaskForUser,
  updateTaskForUser,
  deleteTaskForUser,
  createMicrocycleTemplateFromUser,
  deleteMicrocycleTemplateForUser,
  buildSeasonPlanFormValues,
  buildMicrocycleFormValues,
  buildSessionFormValues,
  buildTemplateFormValues,
  buildTaskFormValues,
  parseSeasonPlanPayload,
  parseMicrocyclePayload,
  parseSessionPayload,
  parseTemplatePayload,
  parseTaskPayload,
};
