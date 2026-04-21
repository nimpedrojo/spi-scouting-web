const {
  createRecommendation,
  updateRecommendation,
  getRecommendationsByPlayer,
  getRecommendationsByTeam,
  getRecommendationsBySeason,
} = require('../services/seasonRecommendationService');
const { requireClubForUser } = require('../services/teamService');
const { canAccessPlayer, canAccessTeam } = require('../services/userScopeService');
const logger = require('../services/logger');

function getRequestedOperationalClubId(req) {
  if (!req || !req.session || !req.session.user || req.session.user.role !== 'superadmin') {
    return null;
  }

  const rawClubId = (req.query && req.query.club_id) || (req.body && req.body.club_id) || null;
  if (!rawClubId) {
    return null;
  }

  const numericClubId = Number(rawClubId);
  return Number.isInteger(numericClubId) ? numericClubId : null;
}

async function resolveOperationalClub(req) {
  const requestedClubId = getRequestedOperationalClubId(req);

  if (req.context && req.context.club && !requestedClubId) {
    return req.context.club;
  }

  return requireClubForUser(req.session.user, { clubId: requestedClubId });
}

function buildValidationResponse(res, errors) {
  return res.status(422).json({ errors });
}

async function createSeasonRecommendation(req, res) {
  try {
    const club = await resolveOperationalClub(req);
    if (!club) {
      return buildValidationResponse(res, ['Debes tener un club activo para crear recomendaciones.']);
    }

    const result = await createRecommendation({
      clubId: club.id,
      seasonId: req.body.seasonId,
      sourceType: req.body.sourceType,
      playerId: req.body.playerId,
      scoutedPlayerId: req.body.scoutedPlayerId,
      recommendedTeamId: req.body.recommendedTeamId,
      recommendedTeamLabel: req.body.recommendedTeamLabel,
      createdBy: req.session.user.id,
      notes: req.body.notes,
    });

    if (result.errors && result.errors.length) {
      return buildValidationResponse(res, result.errors);
    }

    return res.status(201).json(result.recommendation);
  } catch (err) {
    logger.error('Error creating season recommendation', logger.formatError(err));
    return res.status(500).json({ error: 'Ha ocurrido un error al crear la recomendacion.' });
  }
}

async function updateSeasonRecommendation(req, res) {
  try {
    const club = await resolveOperationalClub(req);
    if (!club) {
      return buildValidationResponse(res, ['Debes tener un club activo para actualizar recomendaciones.']);
    }

    const result = await updateRecommendation(req.params.id, {
      clubId: club.id,
      recommendedTeamId: req.body.recommendedTeamId,
      recommendedTeamLabel: req.body.recommendedTeamLabel,
      status: req.body.status,
      notes: req.body.notes,
    });

    if (result.errors && result.errors.length) {
      const isNotFound = result.errors.includes('La recomendacion no existe para el club indicado.');
      return res.status(isNotFound ? 404 : 422).json({ errors: result.errors });
    }

    return res.json(result.recommendation);
  } catch (err) {
    logger.error('Error updating season recommendation', logger.formatError(err));
    return res.status(500).json({ error: 'Ha ocurrido un error al actualizar la recomendacion.' });
  }
}

async function listPlayerRecommendations(req, res) {
  try {
    const club = await resolveOperationalClub(req);
    if (!club) {
      return buildValidationResponse(res, ['Debes tener un club activo para consultar recomendaciones.']);
    }

    const canAccessRequestedPlayer = await canAccessPlayer(req.session.user, req.params.id);
    if (!canAccessRequestedPlayer) {
      return res.status(403).json({ error: 'No tienes permisos para consultar este jugador.' });
    }

    const result = await getRecommendationsByPlayer(req.params.id, {
      clubId: club.id,
    });

    if (result.errors && result.errors.length) {
      return buildValidationResponse(res, result.errors);
    }

    return res.json(result);
  } catch (err) {
    logger.error('Error loading player recommendations', logger.formatError(err));
    return res.status(500).json({ error: 'Ha ocurrido un error al cargar las recomendaciones del jugador.' });
  }
}

async function listTeamRecommendations(req, res) {
  try {
    const club = await resolveOperationalClub(req);
    if (!club) {
      return buildValidationResponse(res, ['Debes tener un club activo para consultar recomendaciones.']);
    }

    const canAccessRequestedTeam = await canAccessTeam(req.session.user, req.params.teamId);
    if (!canAccessRequestedTeam) {
      return res.status(403).json({ error: 'No tienes permisos para consultar este equipo.' });
    }

    const result = await getRecommendationsByTeam(req.query.seasonId, req.params.teamId, {
      clubId: club.id,
    });

    if (result.errors && result.errors.length) {
      return buildValidationResponse(res, result.errors);
    }

    return res.json(result);
  } catch (err) {
    logger.error('Error loading team recommendations', logger.formatError(err));
    return res.status(500).json({ error: 'Ha ocurrido un error al cargar las recomendaciones del equipo.' });
  }
}

async function listSeasonRecommendations(req, res) {
  try {
    const club = await resolveOperationalClub(req);
    if (!club) {
      return buildValidationResponse(res, ['Debes tener un club activo para consultar la coordinacion.']);
    }

    const result = await getRecommendationsBySeason(req.params.id, {
      clubId: club.id,
    });

    if (result.errors && result.errors.length) {
      return buildValidationResponse(res, result.errors);
    }

    return res.json(result);
  } catch (err) {
    logger.error('Error loading season recommendations', logger.formatError(err));
    return res.status(500).json({ error: 'Ha ocurrido un error al cargar la coordinacion de temporada.' });
  }
}

module.exports = {
  createSeasonRecommendation,
  updateSeasonRecommendation,
  listPlayerRecommendations,
  listTeamRecommendations,
  listSeasonRecommendations,
};
