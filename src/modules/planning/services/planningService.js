const { getTeamsByClubId, findTeamById } = require('../../../models/teamModel');
const { getActiveSeasonByClub } = require('../../../services/teamService');
const {
  filterTeamsForUser,
  getActiveTeamScope,
  canAccessTeam,
  isPrivilegedUser,
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
    ? await listSeasonPlansByTeam(club.id, selectedTeam.id)
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

  return seasonPlan;
}

async function getSeasonPlanDetailForUser(user, clubId, seasonPlanId) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, seasonPlanId);
  if (!seasonPlan) {
    return null;
  }

  const microcycles = await listPlanMicrocyclesBySeasonPlan(seasonPlan.id);
  return {
    seasonPlan,
    microcycles,
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

  const sessions = await listPlanSessionsByMicrocycle(microcycle.id);
  return {
    seasonPlan,
    microcycle,
    sessions,
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

async function createMicrocycleForUser(user, clubId, payload) {
  const seasonPlan = await getSeasonPlanContextForUser(user, clubId, payload.seasonPlanId);
  if (!seasonPlan) {
    return { errors: ['La planificación seleccionada no es válida.'] };
  }

  const errors = validateMicrocyclePayload(payload);
  if (errors.length) {
    return { errors };
  }

  const microcycle = await createPlanMicrocycle({
    seasonPlanId: seasonPlan.id,
    name: payload.name,
    orderIndex: payload.orderIndex,
    startDate: payload.startDate,
    endDate: payload.endDate,
    objective: payload.objective,
    phase: payload.phase,
    notes: payload.notes,
  });

  return { seasonPlan, microcycle };
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

async function deleteMicrocycleForUser(user, clubId, microcycleId) {
  const detail = await getMicrocycleDetailForUser(user, clubId, microcycleId);
  if (!detail) {
    return null;
  }

  await deletePlanMicrocycle(detail.microcycle.id);
  return detail;
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

function buildSeasonPlanFormValues(source = {}, fallback = {}) {
  return {
    team_id: source.team_id || fallback.team_id || '',
    season_label: source.season_label || fallback.season_label || '',
    planning_model: source.planning_model || fallback.planning_model || 'structured_microcycle',
    start_date: source.start_date || fallback.start_date || '',
    end_date: source.end_date || fallback.end_date || '',
    objective: source.objective || fallback.objective || '',
    notes: source.notes || fallback.notes || '',
  };
}

function buildMicrocycleFormValues(source = {}, fallback = {}) {
  return {
    season_plan_id: source.season_plan_id || fallback.season_plan_id || '',
    name: source.name || fallback.name || '',
    order_index: source.order_index || fallback.order_index || 1,
    start_date: source.start_date || fallback.start_date || '',
    end_date: source.end_date || fallback.end_date || '',
    objective: source.objective || fallback.objective || '',
    phase: source.phase || fallback.phase || '',
    notes: source.notes || fallback.notes || '',
  };
}

function buildSessionFormValues(source = {}, fallback = {}) {
  return {
    microcycle_id: source.microcycle_id || fallback.microcycle_id || '',
    session_date: source.session_date || fallback.session_date || '',
    title: source.title || fallback.title || '',
    session_type: source.session_type || fallback.session_type || '',
    duration_minutes: source.duration_minutes || fallback.duration_minutes || '',
    objective: source.objective || fallback.objective || '',
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
    objective: normalizeOptionalText(body.objective),
    contents: normalizeOptionalText(body.contents),
    notes: normalizeOptionalText(body.notes),
  };
}

module.exports = {
  PLANNING_MODELS,
  MICRO_PHASES,
  SESSION_TYPES,
  getPlanningHomeData,
  getSeasonPlanFormData,
  getSeasonPlanDetailForUser,
  getSeasonPlanContextForUser,
  getMicrocycleDetailForUser,
  createSeasonPlanForUser,
  updateSeasonPlanForUser,
  deleteSeasonPlanForUser,
  createMicrocycleForUser,
  updateMicrocycleForUser,
  deleteMicrocycleForUser,
  createSessionForUser,
  updateSessionForUser,
  deleteSessionForUser,
  buildSeasonPlanFormValues,
  buildMicrocycleFormValues,
  buildSessionFormValues,
  parseSeasonPlanPayload,
  parseMicrocyclePayload,
  parseSessionPayload,
};
