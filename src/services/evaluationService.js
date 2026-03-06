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
const { EVALUATION_TEMPLATE } = require('./evaluationTemplate');

const MIN_SCORE = 0;
const MAX_SCORE = 10;

function flattenGroupedScores(groupedScores) {
  const flattened = [];
  EVALUATION_TEMPLATE.forEach((area) => {
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

function validateScores(groupedScores) {
  const flattenedScores = flattenGroupedScores(groupedScores);
  const errors = [];

  flattenedScores.forEach((entry) => {
    const numericValue = Number(entry.score);
    if (entry.score === undefined || entry.score === null || entry.score === '') {
      errors.push(`La metrica ${entry.metricLabel} es obligatoria.`);
      return;
    }
    if (Number.isNaN(numericValue) || numericValue < MIN_SCORE || numericValue > MAX_SCORE) {
      errors.push(`La metrica ${entry.metricLabel} debe estar entre ${MIN_SCORE} y ${MAX_SCORE}.`);
    }
  });

  return {
    errors,
    flattenedScores: flattenedScores.map((entry) => ({
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

  const scoreValidation = validateScores(payload.groupedScores);
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

  const groupedMap = rows.reduce((map, row) => {
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
    items: rows,
    groupedByTeam: Array.from(groupedMap.values()),
    filterOptions: {
      teams,
      players,
      authors: authors.filter((author) => author.role === 'admin' || author.role === 'superadmin'),
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

async function getEvaluationFormData(user) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [teams, players, seasons, activeSeason] = await Promise.all([
    getTeamsByClubId(club.id),
    getAllPlayers(club.name),
    getSeasonsByClubId(club.id),
    getActiveSeasonByClub(club.id),
  ]);

  return {
    club,
    teams,
    players,
    seasons,
    activeSeason,
    template: EVALUATION_TEMPLATE,
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
