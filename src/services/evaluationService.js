const db = require('../db');
const { getAllUsers } = require('../models/userModel');
const { getAllPlayers, getPlayerById } = require('../models/playerModel');
const { getTeamsByClubId, findTeamById } = require('../models/teamModel');
const { findSeasonById, getSeasonsByClubId } = require('../models/seasonModel');
const {
  insertEvaluation,
  findEvaluationById,
  listEvaluationsByClub,
  getPlayerEvaluationsByClub,
} = require('../models/evaluationModel');
const {
  insertEvaluationScores,
  getScoresByEvaluationId,
} = require('../models/evaluationScoreModel');
const { requireClubForUser, getActiveSeasonByClub } = require('./teamService');
const {
  resolveBestTemplateForContext,
  getDefaultFallbackTemplate,
  listTemplates,
  getTemplateDetail,
} = require('./evaluationTemplateService');
const {
  canAccessPlayer,
  canAccessTeam,
  filterPlayersForUser,
  filterTeamsForUser,
} = require('./userScopeService');

const MIN_SCORE = 0;
const MAX_SCORE = 10;

function filterPlayersByTeam(players, teamId) {
  if (!Array.isArray(players)) {
    return [];
  }

  if (!teamId) {
    return players;
  }

  return players.filter((player) => String(player.current_team_id || '') === String(teamId));
}

function flattenGroupedScores(groupedScores, templateAreas) {
  const flattened = [];
  templateAreas.forEach((area) => {
    area.metrics.forEach((metric, index) => {
      const rawScore = groupedScores
        && groupedScores[area.key]
        ? groupedScores[area.key][metric.key]
        : undefined;

      flattened.push({
        area: area.key,
        areaLabel: area.label,
        metricKey: metric.key,
        metricLabel: metric.label,
        score: rawScore,
        sortOrder: index + 1,
      });
    });
  });
  return flattened;
}

function validateScores(groupedScores, templateAreas) {
  const flattenedScores = flattenGroupedScores(groupedScores, templateAreas);
  const errors = [];

  flattenedScores.forEach((entry) => {
    const numericValue = Number(entry.score);
    const templateArea = templateAreas.find((area) => area.key === entry.area);
    const templateMetric = templateArea
      ? templateArea.metrics.find((metric) => metric.key === entry.metricKey)
      : null;
    const isRequired = templateMetric ? Boolean(templateMetric.isRequired) : true;

    if ((entry.score === undefined || entry.score === null || entry.score === '') && isRequired) {
      errors.push(`La metrica ${entry.metricLabel} es obligatoria.`);
      return;
    }
    if (entry.score === undefined || entry.score === null || entry.score === '') {
      return;
    }
    if (Number.isNaN(numericValue) || numericValue < MIN_SCORE || numericValue > MAX_SCORE) {
      errors.push(`La metrica ${entry.metricLabel} debe estar entre ${MIN_SCORE} y ${MAX_SCORE}.`);
    }
  });

  return {
    errors,
    flattenedScores: flattenedScores
      .filter((entry) => !(entry.score === undefined || entry.score === null || entry.score === ''))
      .map((entry) => ({
        ...entry,
        score: Number(entry.score),
      })),
  };
}

function calculateOverallScore(flattenedScores) {
  if (!flattenedScores.length) {
    return 0;
  }
  const total = flattenedScores.reduce((sum, entry) => sum + Number(entry.score), 0);
  return Number((total / flattenedScores.length).toFixed(2));
}

async function createEvaluationWithScores(user, payload, options = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return { errors: ['Debes tener un club activo para crear evaluaciones.'] };
  }

  const resolvedTemplate = payload.templateId
    ? await resolveBestTemplateForContext(user, {
      teamId: payload.teamId,
      playerId: payload.playerId,
    })
    : await resolveBestTemplateForContext(user, {
      teamId: payload.teamId,
      playerId: payload.playerId,
    });
  const template = payload.templateMetrics && payload.templateMetrics.length
    ? { metrics: payload.templateMetrics }
    : (resolvedTemplate || getDefaultFallbackTemplate());

  const [team, player, season] = await Promise.all([
    findTeamById(payload.teamId),
    getPlayerById(payload.playerId, club.name),
    findSeasonById(payload.seasonId),
  ]);

  const validationErrors = [];
  if (!team || team.club_id !== club.id) {
    validationErrors.push('El equipo seleccionado no es valido.');
  }
  if (!player || player.club !== club.name) {
    validationErrors.push('El jugador seleccionado no es valido.');
  }
  if (!season || season.club_id !== club.id) {
    validationErrors.push('La temporada seleccionada no es valida.');
  }
  if (!payload.evaluationDate) {
    validationErrors.push('La fecha de evaluacion es obligatoria.');
  }
  if (!(await canAccessTeam(user, payload.teamId))) {
    validationErrors.push('No tienes permisos sobre el equipo seleccionado.');
  }
  if (!(await canAccessPlayer(user, payload.playerId))) {
    validationErrors.push('No tienes permisos sobre el jugador seleccionado.');
  }

  const scoreValidation = validateScores(payload.groupedScores, template.metrics);
  validationErrors.push(...scoreValidation.errors);

  if (validationErrors.length) {
    return { errors: validationErrors };
  }

  const overallScore = calculateOverallScore(scoreValidation.flattenedScores);
  if (options.dryRun) {
    return { evaluation: { id: null, overall_score: overallScore }, dryRun: true };
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const insertedEvaluation = await insertEvaluation(connection, {
      clubId: club.id,
      seasonId: payload.seasonId,
      teamId: payload.teamId,
      playerId: payload.playerId,
      authorId: user.id,
      evaluationDate: payload.evaluationDate,
      source: payload.source || 'manual',
      title: payload.title || null,
      notes: payload.notes || null,
      overallScore,
    });
    await insertEvaluationScores(connection, insertedEvaluation.id, scoreValidation.flattenedScores);
    await connection.commit();
    const createdEvaluation = await findEvaluationById(insertedEvaluation.id);
    return { evaluation: createdEvaluation };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function listEvaluations(user, filters = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return { items: [], groupedByTeam: [], filterOptions: null };
  }

  const [rows, teams, players, authors, seasons, activeSeason] = await Promise.all([
    listEvaluationsByClub(club.id, filters),
    getTeamsByClubId(club.id),
    getAllPlayers(club.name),
    getAllUsers(club.name),
    getSeasonsByClubId(club.id),
    getActiveSeasonByClub(club.id),
  ]);
  const [visibleTeams, visiblePlayers] = await Promise.all([
    filterTeamsForUser(user, teams),
    filterPlayersForUser(user, players),
  ]);
  const visibleTeamIds = new Set(visibleTeams.map((team) => String(team.id)));
  const visiblePlayerIds = new Set(visiblePlayers.map((player) => String(player.id)));
  const visibleRows = rows.filter((row) => (
    visibleTeamIds.has(String(row.team_id)) && visiblePlayerIds.has(String(row.player_id))
  ));

  const groupedMap = visibleRows.reduce((map, row) => {
    if (!map.has(row.team_id)) {
      map.set(row.team_id, {
        teamId: row.team_id,
        teamName: row.team_name,
        total: 0,
        items: [],
      });
    }
    const group = map.get(row.team_id);
    group.total += 1;
    group.items.push({
      ...row,
      player_full_name: `${row.first_name} ${row.last_name}`.trim(),
    });
    return map;
  }, new Map());

  return {
    items: visibleRows,
    groupedByTeam: Array.from(groupedMap.values()),
    filterOptions: {
      teams: visibleTeams,
      players: visiblePlayers,
      authors,
      seasons,
      activeSeason,
    },
  };
}

async function getEvaluationsGroupedByTeam(user, filters = {}) {
  const list = await listEvaluations(user, filters);
  return list.groupedByTeam;
}

async function getPlayerEvaluationsHistory(user, playerId) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [player, history] = await Promise.all([
    getPlayerById(playerId, club.name),
    getPlayerEvaluationsByClub(club.id, playerId),
  ]);

  if (!player) {
    return null;
  }
  if (!(await canAccessPlayer(user, playerId))) {
    return null;
  }

  return {
    player: {
      ...player,
      full_name: `${player.first_name} ${player.last_name}`.trim(),
    },
    items: history,
  };
}

async function getEvaluationDetail(user, evaluationId) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }
  const evaluation = await findEvaluationById(evaluationId);
  if (!evaluation || evaluation.club_id !== club.id) {
    return null;
  }
  if (!(await canAccessTeam(user, evaluation.team_id)) || !(await canAccessPlayer(user, evaluation.player_id))) {
    return null;
  }
  const scores = await getScoresByEvaluationId(evaluationId);
  const groupedScores = scores.reduce((map, score) => {
    if (!map[score.area]) {
      map[score.area] = [];
    }
    map[score.area].push(score);
    return map;
  }, {});

  return {
    ...evaluation,
    player_full_name: `${evaluation.first_name} ${evaluation.last_name}`.trim(),
    groupedScores,
  };
}

async function getEvaluationFormData(user, options = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [teams, players, seasons, activeSeason, availableTemplates] = await Promise.all([
    getTeamsByClubId(club.id),
    getAllPlayers(club.name),
    getSeasonsByClubId(club.id),
    getActiveSeasonByClub(club.id),
    listTemplates(user),
  ]);
  const [visibleTeams, visiblePlayers] = await Promise.all([
    filterTeamsForUser(user, teams),
    filterPlayersForUser(user, players),
  ]);
  const filteredPlayers = filterPlayersByTeam(visiblePlayers, options.teamId || null);

  let resolvedTemplate = null;
  if (options.templateId) {
    resolvedTemplate = await getTemplateDetail(user, options.templateId);
  }
  if (!resolvedTemplate) {
    resolvedTemplate = await resolveBestTemplateForContext(user, {
      teamId: options.teamId || null,
      playerId: options.playerId || null,
    });
  }

  return {
    club,
    teams: visibleTeams,
    players: filteredPlayers,
    allPlayers: visiblePlayers,
    teamId: options.teamId || null,
    playerId: options.playerId || null,
    seasons,
    activeSeason,
    template: resolvedTemplate.metrics,
    templateId: resolvedTemplate.id,
    availableTemplates: availableTemplates || [],
  };
}

module.exports = {
  MIN_SCORE,
  MAX_SCORE,
  validateScores,
  flattenGroupedScores,
  calculateOverallScore,
  createEvaluationWithScores,
  listEvaluations,
  getEvaluationsGroupedByTeam,
  getPlayerEvaluationsHistory,
  getEvaluationDetail,
  getEvaluationFormData,
};
