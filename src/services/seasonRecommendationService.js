const { getPlayerById } = require('../models/playerModel');
const { findTeamById } = require('../models/teamModel');
const { findSeasonById } = require('../models/seasonModel');
const {
  SEASON_TEAM_RECOMMENDATION_SOURCE_TYPES,
  SEASON_TEAM_RECOMMENDATION_STATUSES,
  createSeasonTeamRecommendation,
  findSeasonTeamRecommendationByIdAndClubId,
  getSeasonTeamRecommendationsByFilters,
  updateSeasonTeamRecommendation,
} = require('../models/seasonTeamRecommendationModel');

function normalizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeNullableInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeNullableLowercaseString(value) {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function buildValidationResult(errors) {
  return {
    errors,
  };
}

function sortRecommendationsByDateDesc(items) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();

    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return String(right.id || '').localeCompare(String(left.id || ''));
  });
}

async function validateSeasonClubScope(clubId, seasonId) {
  const season = await findSeasonById(seasonId);

  if (!season || season.club_id !== clubId) {
    return {
      season: null,
      errors: ['La temporada seleccionada no es valida para el club indicado.'],
    };
  }

  return { season, errors: [] };
}

async function validateRecommendedTeamScope({ clubId, seasonId, recommendedTeamId }) {
  if (!recommendedTeamId) {
    return { team: null, errors: [] };
  }

  const team = await findTeamById(recommendedTeamId);
  const errors = [];

  if (!team || team.club_id !== clubId) {
    errors.push('El equipo recomendado no pertenece al club indicado.');
  } else if (seasonId && String(team.season_id) !== String(seasonId)) {
    errors.push('El equipo recomendado no pertenece a la temporada indicada.');
  }

  return { team, errors };
}

async function validateInternalPlayerScope({ clubId, playerId }) {
  if (!playerId) {
    return {
      player: null,
      errors: ['El jugador interno es obligatorio.'],
    };
  }

  const player = await getPlayerById(playerId);
  if (!player || Number(player.club_id) !== Number(clubId)) {
    return {
      player: null,
      errors: ['El jugador interno no pertenece al club indicado.'],
    };
  }

  return { player, errors: [] };
}

function validateSourceType(sourceType) {
  if (!SEASON_TEAM_RECOMMENDATION_SOURCE_TYPES.includes(sourceType)) {
    return ['El tipo de origen no es valido.'];
  }

  return [];
}

function validateStatus(status) {
  if (!SEASON_TEAM_RECOMMENDATION_STATUSES.includes(status)) {
    return ['El estado no es valido.'];
  }

  return [];
}

/**
 * Crea una recomendación histórica para una temporada destino.
 * Requiere `clubId`, `seasonId`, `sourceType` y `createdBy`.
 */
async function createRecommendation(data = {}) {
  const clubId = normalizeNullableInteger(data.clubId);
  const seasonId = normalizeNullableString(data.seasonId);
  const sourceType = normalizeNullableLowercaseString(data.sourceType);
  const playerId = normalizeNullableInteger(data.playerId);
  const scoutedPlayerId = normalizeNullableString(data.scoutedPlayerId);
  const recommendedTeamId = normalizeNullableString(data.recommendedTeamId);
  const recommendedTeamLabel = normalizeNullableString(data.recommendedTeamLabel);
  const createdBy = normalizeNullableInteger(data.createdBy);
  const notes = normalizeNullableString(data.notes);
  const errors = [];

  if (!clubId) {
    errors.push('El club es obligatorio.');
  }

  if (!seasonId) {
    errors.push('La temporada destino es obligatoria.');
  }

  if (!createdBy) {
    errors.push('El usuario creador es obligatorio.');
  }

  errors.push(...validateSourceType(sourceType));

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const seasonValidation = await validateSeasonClubScope(clubId, seasonId);
  errors.push(...seasonValidation.errors);

  if (sourceType === 'internal') {
    const playerValidation = await validateInternalPlayerScope({ clubId, playerId });
    errors.push(...playerValidation.errors);

    if (scoutedPlayerId) {
      errors.push('No se puede informar un jugador scouted cuando el origen es internal.');
    }
  }

  if (sourceType === 'scouted') {
    if (!scoutedPlayerId) {
      errors.push('El identificador del jugador scouted es obligatorio cuando el origen es scouted.');
    }

    if (playerId) {
      errors.push('No se puede informar un jugador interno cuando el origen es scouted.');
    }
  }

  const teamValidation = await validateRecommendedTeamScope({
    clubId,
    seasonId,
    recommendedTeamId,
  });
  errors.push(...teamValidation.errors);

  if (!recommendedTeamId && !recommendedTeamLabel) {
    errors.push('Debes indicar un equipo destino o una etiqueta provisional.');
  }

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const recommendation = await createSeasonTeamRecommendation({
    clubId,
    seasonId,
    sourceType,
    playerId,
    scoutedPlayerId,
    recommendedTeamId,
    recommendedTeamLabel,
    status: 'proposed',
    notes,
    createdBy,
  });

  return { recommendation };
}

/**
 * Actualiza solo los campos editables de una recomendación existente.
 * Requiere `clubId` para mantener el aislamiento entre clubes.
 */
async function updateRecommendation(id, data = {}) {
  const recommendationId = normalizeNullableString(id);
  const clubId = normalizeNullableInteger(data.clubId);
  const recommendedTeamId = normalizeNullableString(data.recommendedTeamId);
  const recommendedTeamLabel = normalizeNullableString(data.recommendedTeamLabel);
  const status = normalizeNullableLowercaseString(data.status);
  const notes = Object.prototype.hasOwnProperty.call(data, 'notes')
    ? normalizeNullableString(data.notes)
    : undefined;
  const errors = [];

  if (!recommendationId) {
    errors.push('La recomendacion es obligatoria.');
  }

  if (!clubId) {
    errors.push('El club es obligatorio.');
  }

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const current = await findSeasonTeamRecommendationByIdAndClubId(recommendationId, clubId);
  if (!current) {
    return buildValidationResult(['La recomendacion no existe para el club indicado.']);
  }

  if (status) {
    errors.push(...validateStatus(status));
  }

  const targetTeamId = Object.prototype.hasOwnProperty.call(data, 'recommendedTeamId')
    ? recommendedTeamId
    : current.recommended_team_id;
  const targetTeamLabel = Object.prototype.hasOwnProperty.call(data, 'recommendedTeamLabel')
    ? recommendedTeamLabel
    : current.recommended_team_label;

  if (!targetTeamId && !targetTeamLabel) {
    errors.push('Debes conservar un equipo destino o una etiqueta provisional.');
  }

  const teamValidation = await validateRecommendedTeamScope({
    clubId,
    seasonId: current.season_id,
    recommendedTeamId: targetTeamId,
  });
  errors.push(...teamValidation.errors);

  if (errors.length) {
    return buildValidationResult(errors);
  }

  await updateSeasonTeamRecommendation(recommendationId, {
    recommendedTeamId,
    recommendedTeamLabel,
    status,
    notes,
  });

  const recommendation = await findSeasonTeamRecommendationByIdAndClubId(recommendationId, clubId);
  return { recommendation };
}

/**
 * Devuelve el histórico de recomendaciones de un jugador interno.
 * Requiere `clubId` para no mezclar datos entre clubes.
 */
async function getRecommendationsByPlayer(playerId, options = {}) {
  const normalizedPlayerId = normalizeNullableInteger(playerId);
  const clubId = normalizeNullableInteger(options.clubId);
  const errors = [];

  if (!normalizedPlayerId) {
    errors.push('El jugador es obligatorio.');
  }

  if (!clubId) {
    errors.push('El club es obligatorio.');
  }

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const playerValidation = await validateInternalPlayerScope({
    clubId,
    playerId: normalizedPlayerId,
  });

  if (playerValidation.errors.length) {
    return buildValidationResult(playerValidation.errors);
  }

  const recommendations = await getSeasonTeamRecommendationsByFilters({
    clubId,
    playerId: normalizedPlayerId,
    sourceType: 'internal',
  });

  return {
    player: playerValidation.player,
    recommendations: sortRecommendationsByDateDesc(recommendations),
  };
}

/**
 * Devuelve las recomendaciones de un equipo destino separadas por origen.
 * Requiere `clubId` para asegurar el alcance del club.
 */
async function getRecommendationsByTeam(seasonId, teamId, options = {}) {
  const normalizedSeasonId = normalizeNullableString(seasonId);
  const normalizedTeamId = normalizeNullableString(teamId);
  const clubId = normalizeNullableInteger(options.clubId);
  const errors = [];

  if (!normalizedSeasonId) {
    errors.push('La temporada es obligatoria.');
  }

  if (!normalizedTeamId) {
    errors.push('El equipo es obligatorio.');
  }

  if (!clubId) {
    errors.push('El club es obligatorio.');
  }

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const [seasonValidation, teamValidation] = await Promise.all([
    validateSeasonClubScope(clubId, normalizedSeasonId),
    validateRecommendedTeamScope({
      clubId,
      seasonId: normalizedSeasonId,
      recommendedTeamId: normalizedTeamId,
    }),
  ]);

  errors.push(...seasonValidation.errors, ...teamValidation.errors);

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const recommendations = await getSeasonTeamRecommendationsByFilters({
    clubId,
    seasonId: normalizedSeasonId,
    teamId: normalizedTeamId,
  });

  const orderedRecommendations = sortRecommendationsByDateDesc(recommendations);

  return {
    team: teamValidation.team,
    season: seasonValidation.season,
    internalRecommendations: orderedRecommendations.filter((item) => item.source_type === 'internal'),
    externalRecommendations: orderedRecommendations.filter((item) => item.source_type === 'scouted'),
  };
}

/**
 * Devuelve la vista agregada de coordinación para una temporada.
 * Agrupa por equipo destino y expone también el listado plano ordenado.
 */
async function getRecommendationsBySeason(seasonId, options = {}) {
  const normalizedSeasonId = normalizeNullableString(seasonId);
  const clubId = normalizeNullableInteger(options.clubId);
  const errors = [];

  if (!normalizedSeasonId) {
    errors.push('La temporada es obligatoria.');
  }

  if (!clubId) {
    errors.push('El club es obligatorio.');
  }

  if (errors.length) {
    return buildValidationResult(errors);
  }

  const seasonValidation = await validateSeasonClubScope(clubId, normalizedSeasonId);
  if (seasonValidation.errors.length) {
    return buildValidationResult(seasonValidation.errors);
  }

  const recommendations = await getSeasonTeamRecommendationsByFilters({
    clubId,
    seasonId: normalizedSeasonId,
  });
  const orderedRecommendations = sortRecommendationsByDateDesc(recommendations);

  const groupedByTeamMap = orderedRecommendations.reduce((acc, item) => {
    const key = item.recommended_team_id || `label:${item.recommended_team_label || 'pending'}`;

    if (!acc.has(key)) {
      acc.set(key, {
        teamId: item.recommended_team_id || null,
        teamName: item.recommended_team_name || item.recommended_team_label || 'Sin asignar',
        internalRecommendations: [],
        externalRecommendations: [],
        total: 0,
      });
    }

    const group = acc.get(key);
    group.total += 1;

    if (item.source_type === 'internal') {
      group.internalRecommendations.push(item);
    } else {
      group.externalRecommendations.push(item);
    }

    return acc;
  }, new Map());

  const statusSummary = orderedRecommendations.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    season: seasonValidation.season,
    recommendations: orderedRecommendations,
    groupedByTeam: Array.from(groupedByTeamMap.values()),
    statusSummary,
  };
}

module.exports = {
  createRecommendation,
  updateRecommendation,
  getRecommendationsByPlayer,
  getRecommendationsByTeam,
  getRecommendationsBySeason,
};
