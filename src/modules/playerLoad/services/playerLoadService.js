const { findTeamById, getTeamsByClubId } = require('../../../models/teamModel');
const { findSeasonById } = require('../../../models/seasonModel');
const { getPlayersByTeamId } = require('../../../models/teamPlayerModel');
const {
  filterTeamsForUser,
  canAccessTeam,
} = require('../../../services/userScopeService');
const {
  createPlayerLoadActivity,
  findPlayerLoadActivityById,
  listPlayerLoadActivities,
  updatePlayerLoadActivity,
  deletePlayerLoadActivity,
} = require('../models/playerLoadActivityModel');
const {
  replacePlayerLoadEntries,
  listPlayerLoadEntriesByActivity,
  listPlayerLoadEntriesForTeamPeriod,
} = require('../models/playerLoadEntryModel');
const {
  toIsoDate,
  buildMetricWindows,
  calculateExposureForPeriod,
  decorateComparisons,
  buildTemporalEvolution,
  buildExposureComposition,
  buildWeeklyEvolution,
  buildExposureMap,
  buildPersonalHistory,
  buildPlayerAnalyticalDetail,
} = require('./playerLoadMetricsService');

const ACTIVITY_TYPES = ['TRAINING', 'MATCH'];
const ACTIVITY_STATUSES = ['done', 'planned', 'cancelled'];

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeActivityType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ACTIVITY_TYPES.includes(normalized) ? normalized : null;
}

function normalizeStatus(value) {
  const normalized = normalizeOptionalText(value) || 'done';
  return ACTIVITY_STATUSES.includes(normalized) ? normalized : 'done';
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 'on' || value === 1;
}

function parseEntriesFromBody(body) {
  const rawEntries = Array.isArray(body.entries)
    ? body.entries
    : Object.keys(body || {})
      .filter((key) => key.startsWith('entries['))
      .reduce((entries, key) => {
        const match = key.match(/^entries\[(\d+)]\[(.+)]$/);
        if (!match) {
          return entries;
        }
        const index = Number(match[1]);
        const field = match[2];
        if (!entries[index]) {
          entries[index] = {};
        }
        entries[index][field] = body[key];
        return entries;
      }, []);

  return rawEntries
    .filter(Boolean)
    .map((entry) => ({
      playerId: Number(entry.player_id || entry.playerId),
      attended: normalizeBoolean(entry.attended),
      exposureMinutesRaw: entry.exposure_minutes ?? entry.exposureMinutes,
      exposureMinutes: normalizeInteger(entry.exposure_minutes ?? entry.exposureMinutes),
      notes: normalizeOptionalText(entry.notes),
    }));
}

function parseActivityPayload(body = {}) {
  return {
    teamId: normalizeOptionalText(body.team_id || body.teamId),
    seasonId: normalizeOptionalText(body.season_id || body.seasonId),
    activityType: normalizeActivityType(body.activity_type || body.activityType),
    activityDate: toIsoDate(body.activity_date || body.activityDate),
    title: normalizeOptionalText(body.title),
    durationMinutesRaw: body.duration_minutes ?? body.durationMinutes,
    durationMinutes: normalizeInteger(body.duration_minutes ?? body.durationMinutes),
    status: normalizeStatus(body.status),
    notes: normalizeOptionalText(body.notes),
    entries: parseEntriesFromBody(body),
  };
}

async function resolveSelectedTeam(user, clubId, requestedTeamId = null, seasonId = null) {
  const teams = await getTeamsByClubId(clubId);
  const seasonTeams = seasonId
    ? teams.filter((team) => String(team.season_id) === String(seasonId))
    : teams;
  const visibleTeams = await filterTeamsForUser(user, seasonTeams);
  const selectedTeam = requestedTeamId
    ? visibleTeams.find((team) => String(team.id) === String(requestedTeamId))
    : visibleTeams[0];

  return {
    visibleTeams,
    selectedTeam: selectedTeam || null,
  };
}

async function validateActivityPayload(user, clubId, payload, options = {}) {
  const errors = [];

  if (!payload.activityType) {
    errors.push('El tipo de actividad debe ser TRAINING o MATCH.');
  }
  if (!payload.activityDate) {
    errors.push('La fecha de actividad es obligatoria.');
  }
  if (!payload.title) {
    errors.push('El titulo de la actividad es obligatorio.');
  }
  if (payload.durationMinutes === null && normalizeOptionalText(payload.durationMinutesRaw)) {
    errors.push('La duracion debe ser un numero entero positivo.');
  }
  if (payload.activityType === 'TRAINING' && (payload.durationMinutes === null || payload.durationMinutes <= 0)) {
    errors.push('La duracion de la sesion de entrenamiento es obligatoria.');
  }
  if (!payload.teamId) {
    errors.push('El equipo es obligatorio.');
  }
  if (!payload.seasonId) {
    errors.push('La temporada es obligatoria.');
  }

  const [team, season] = await Promise.all([
    payload.teamId ? findTeamById(payload.teamId) : Promise.resolve(null),
    payload.seasonId ? findSeasonById(payload.seasonId) : Promise.resolve(null),
  ]);

  if (payload.teamId && (!team || Number(team.club_id) !== Number(clubId))) {
    errors.push('El equipo seleccionado no es valido para tu club.');
  }
  if (payload.seasonId && (!season || Number(season.club_id) !== Number(clubId))) {
    errors.push('La temporada seleccionada no es valida para tu club.');
  }
  if (team && season && String(team.season_id) !== String(season.id)) {
    errors.push('El equipo no pertenece a la temporada seleccionada.');
  }
  if (payload.teamId && !(await canAccessTeam(user, payload.teamId))) {
    errors.push('No tienes acceso al equipo seleccionado.');
  }

  const roster = team ? await getPlayersByTeamId(team.id) : [];
  const rosterIds = new Set(roster.map((player) => Number(player.player_id)));
  const entryPlayerIds = new Set();

  payload.entries.forEach((entry) => {
    if (!Number.isInteger(entry.playerId) || !rosterIds.has(entry.playerId)) {
      errors.push('Todos los registros deben pertenecer a jugadores del equipo.');
      return;
    }
    if (entryPlayerIds.has(entry.playerId)) {
      errors.push('No puede haber jugadores duplicados en una actividad.');
      return;
    }
    entryPlayerIds.add(entry.playerId);
    if (entry.exposureMinutes === null && normalizeOptionalText(entry.exposureMinutesRaw)) {
      errors.push('Los minutos de exposicion deben ser enteros positivos.');
    }
  });

  if (options.requireEntries && !payload.entries.length) {
    errors.push('Debes registrar al menos un jugador.');
  }

  return { errors, team, season, roster };
}

function normalizeEntriesForActivity(payload, roster) {
  const entriesByPlayer = new Map(payload.entries.map((entry) => [Number(entry.playerId), entry]));

  return roster.map((player) => {
    const playerId = Number(player.player_id);
    const entry = entriesByPlayer.get(playerId);
    const attended = entry ? entry.attended : false;
    const fallbackTrainingMinutes = payload.activityType === 'TRAINING' && attended
      ? Number(payload.durationMinutes || 0)
      : 0;

    return {
      playerId,
      attended,
      exposureMinutes: attended
        ? Number(entry && entry.exposureMinutes !== null ? entry.exposureMinutes : fallbackTrainingMinutes)
        : 0,
      notes: entry ? entry.notes : null,
    };
  });
}

async function createActivityForUser(user, clubId, rawPayload) {
  const payload = parseActivityPayload(rawPayload);
  const validation = await validateActivityPayload(user, clubId, payload, { requireEntries: true });

  if (validation.errors.length) {
    return { errors: validation.errors };
  }

  const activity = await createPlayerLoadActivity({
    clubId,
    seasonId: validation.season.id,
    teamId: validation.team.id,
    activityType: payload.activityType,
    activityDate: payload.activityDate,
    title: payload.title,
    durationMinutes: payload.durationMinutes,
    status: payload.status,
    notes: payload.notes,
    createdBy: user ? user.id : null,
  });

  const entries = normalizeEntriesForActivity(payload, validation.roster);
  await replacePlayerLoadEntries(activity.id, entries);

  return {
    activity: await findPlayerLoadActivityById(activity.id),
    entries: await listPlayerLoadEntriesByActivity(activity.id),
  };
}

async function updateActivityForUser(user, clubId, activityId, rawPayload) {
  const activity = await findPlayerLoadActivityById(activityId);
  if (!activity || Number(activity.club_id) !== Number(clubId)) {
    return { errors: ['Actividad no encontrada.'] };
  }
  if (!(await canAccessTeam(user, activity.team_id))) {
    return { errors: ['No tienes acceso a esta actividad.'] };
  }

  const payload = parseActivityPayload({
    ...rawPayload,
    team_id: activity.team_id,
    season_id: activity.season_id,
  });
  const validation = await validateActivityPayload(user, clubId, payload, { requireEntries: true });

  if (validation.errors.length) {
    return { errors: validation.errors };
  }

  await updatePlayerLoadActivity(activity.id, {
    activityType: payload.activityType,
    activityDate: payload.activityDate,
    title: payload.title,
    durationMinutes: payload.durationMinutes,
    status: payload.status,
    notes: payload.notes,
  });
  await replacePlayerLoadEntries(activity.id, normalizeEntriesForActivity(payload, validation.roster));

  return getActivityDetailForUser(user, clubId, activity.id);
}

async function deleteActivityForUser(user, clubId, activityId) {
  const activity = await findPlayerLoadActivityById(activityId);
  if (!activity || Number(activity.club_id) !== Number(clubId)) {
    return null;
  }
  if (!(await canAccessTeam(user, activity.team_id))) {
    return null;
  }

  await deletePlayerLoadActivity(activity.id);
  return activity;
}

async function getActivityDetailForUser(user, clubId, activityId) {
  const activity = await findPlayerLoadActivityById(activityId);
  if (!activity || Number(activity.club_id) !== Number(clubId)) {
    return null;
  }
  if (!(await canAccessTeam(user, activity.team_id))) {
    return null;
  }

  const entries = await listPlayerLoadEntriesByActivity(activity.id);
  return { activity, entries };
}

function filterByDateRange(rows, dateFrom, dateTo, fieldName = 'activity_date') {
  return rows.filter((row) => {
    const isoDate = toIsoDate(row[fieldName]);
    if (!isoDate) {
      return false;
    }
    if (dateFrom && isoDate < dateFrom) {
      return false;
    }
    if (dateTo && isoDate > dateTo) {
      return false;
    }
    return true;
  });
}

async function buildWindowSummary({
  roster,
  activities,
  entries,
  window,
  previousWindow = null,
}) {
  const currentActivities = window.dateFrom || window.dateTo
    ? filterByDateRange(activities, window.dateFrom, window.dateTo)
    : activities;
  const currentEntries = window.dateFrom || window.dateTo
    ? filterByDateRange(entries, window.dateFrom, window.dateTo)
    : entries;
  const previousActivities = previousWindow
    ? filterByDateRange(activities, previousWindow.dateFrom, previousWindow.dateTo)
    : [];
  const previousEntries = previousWindow
    ? filterByDateRange(entries, previousWindow.dateFrom, previousWindow.dateTo)
    : [];

  const current = calculateExposureForPeriod(roster, currentActivities, currentEntries);
  const previous = previousWindow
    ? calculateExposureForPeriod(roster, previousActivities, previousEntries)
    : current;

  return {
    ...window,
    players: decorateComparisons(current.players, previous.players, current.teamAverage),
    teamAverage: current.teamAverage,
    previousTeamAverage: previous.teamAverage,
    composition: buildExposureComposition(
      current.players.reduce((sum, player) => sum + Number(player.trainingMinutes || 0), 0),
      current.players.reduce((sum, player) => sum + Number(player.matchMinutes || 0), 0),
    ),
    evolution: buildTemporalEvolution(currentEntries),
  };
}

function buildTeamSummary(windowSummary) {
  const players = windowSummary && Array.isArray(windowSummary.players) ? windowSummary.players : [];
  const totalExposure = players.reduce((sum, player) => sum + Number(player.totalExposureMinutes || 0), 0);
  const matchMinutes = players.reduce((sum, player) => sum + Number(player.matchMinutes || 0), 0);
  const attendanceValues = players
    .map((player) => player.attendancePercentage)
    .filter((value) => value !== null && value !== undefined);
  const averageAttendance = attendanceValues.length
    ? Math.round((attendanceValues.reduce((sum, value) => sum + Number(value || 0), 0) / attendanceValues.length) * 10) / 10
    : null;

  return {
    totalExposureMinutes: totalExposure,
    averageExposureMinutes: players.length ? Math.round((totalExposure / players.length) * 10) / 10 : 0,
    averageAttendancePercentage: averageAttendance,
    matchMinutes,
    distribution: players.map((player) => ({
      playerId: player.playerId,
      fullName: player.fullName,
      totalExposureMinutes: player.totalExposureMinutes,
      percentage: totalExposure > 0
        ? Math.round((Number(player.totalExposureMinutes || 0) / totalExposure) * 1000) / 10
        : 0,
    })),
  };
}

function attachPersonalHistoryToWindows(windows, personalHistory) {
  const historyByPlayer = new Map(personalHistory.map((history) => [String(history.playerId), history]));

  Object.values(windows).forEach((window) => {
    if (!window || !Array.isArray(window.players)) {
      return;
    }
    window.players = window.players.map((player) => ({
      ...player,
      personalHistory: historyByPlayer.get(String(player.playerId)) || null,
    }));
  });
}

async function getPlayerLoadHomeData(user, club, activeSeason, filters = {}) {
  if (!club || !club.id || !activeSeason || !activeSeason.id) {
    return null;
  }

  const requestedTeamId = normalizeOptionalText(filters.team_id || filters.teamId);
  const requestedPeriod = normalizeOptionalText(filters.period) || 'sevenDays';
  const requestedPlayerId = normalizeOptionalText(filters.player_id || filters.playerId);
  const referenceDate = toIsoDate(filters.reference_date || filters.referenceDate || new Date())
    || toIsoDate(new Date());
  const { visibleTeams, selectedTeam } = await resolveSelectedTeam(
    user,
    club.id,
    requestedTeamId,
    activeSeason.id,
  );

  if (!selectedTeam) {
    return {
      club,
      activeSeason,
      visibleTeams,
      selectedTeam: null,
      windows: {},
      activities: [],
      exposureDefinition: 'Player Load MVP registra exposicion observada: minutos de entrenamiento y partido. No es una medida fisiologica de carga.',
    };
  }

  const [roster, activities, entries] = await Promise.all([
    getPlayersByTeamId(selectedTeam.id),
    listPlayerLoadActivities({
      clubId: club.id,
      seasonId: activeSeason.id,
      teamId: selectedTeam.id,
    }),
    listPlayerLoadEntriesForTeamPeriod({
      clubId: club.id,
      seasonId: activeSeason.id,
      teamId: selectedTeam.id,
    }),
  ]);
  const metricWindows = buildMetricWindows(referenceDate);
  const weeklyEvolution = buildWeeklyEvolution(roster, entries, referenceDate, 8);
  const exposureMap = buildExposureMap(weeklyEvolution, { weekLimit: 8 });
  const personalHistory = buildPersonalHistory(roster, entries, referenceDate);

  const windows = {};
  for (const [key, window] of Object.entries(metricWindows)) {
    // eslint-disable-next-line no-await-in-loop
    windows[key] = await buildWindowSummary({
      roster,
      activities,
      entries,
      window,
      previousWindow: window.previous,
    });
  }
  attachPersonalHistoryToWindows(windows, personalHistory);
  const selectedPeriod = windows[requestedPeriod] ? requestedPeriod : 'sevenDays';
  const selectedWindow = windows[selectedPeriod];

  return {
    club,
    activeSeason,
    visibleTeams,
    selectedTeam,
    roster,
    activities,
    windows,
    selectedPeriod,
    selectedWindow,
    teamSummary: buildTeamSummary(selectedWindow),
    playerDetail: buildPlayerAnalyticalDetail({
      selectedPlayerId: requestedPlayerId,
      roster,
      activities,
      entries,
      windows,
      weeklyEvolution,
      personalHistory,
      selectedTeam,
      activeSeason,
      referenceDate,
    }),
    weeklyEvolution,
    exposureMap,
    personalHistory,
    referenceDate,
    exposureDefinition: 'Player Load MVP registra exposicion observada: minutos de entrenamiento y partido. No es una medida fisiologica de carga.',
  };
}

async function getActivityFormData(user, club, activeSeason, options = {}) {
  const requestedTeamId = normalizeOptionalText(options.teamId || options.team_id);
  const { visibleTeams, selectedTeam } = await resolveSelectedTeam(
    user,
    club.id,
    requestedTeamId,
    activeSeason ? activeSeason.id : null,
  );
  const roster = selectedTeam ? await getPlayersByTeamId(selectedTeam.id) : [];

  return {
    activeSeason,
    visibleTeams,
    selectedTeam,
    roster,
    activityTypes: ACTIVITY_TYPES,
    statuses: ACTIVITY_STATUSES,
  };
}

module.exports = {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  parseActivityPayload,
  getPlayerLoadHomeData,
  getActivityFormData,
  getActivityDetailForUser,
  createActivityForUser,
  updateActivityForUser,
  deleteActivityForUser,
};
