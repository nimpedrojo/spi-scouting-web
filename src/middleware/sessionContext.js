const { requireClubForUser, getActiveSeasonByClub } = require('../services/teamService');
const logger = require('../services/logger');

function shouldRefreshContext(user, storedContext) {
  if (!user || !user.default_club) {
    return false;
  }

  if (!storedContext) {
    return true;
  }

  return storedContext.clubName !== user.default_club;
}

async function attachSessionContext(req, res, next) {
  const user = req.session.user || null;

  req.context = {
    user,
    club: null,
    activeSeason: null,
  };

  if (!user || !user.default_club) {
    req.session.clubContext = null;
    req.session.clubId = null;
    req.session.seasonId = null;
    return next();
  }

  try {
    if (shouldRefreshContext(user, req.session.clubContext)) {
      const club = await requireClubForUser(user);
      const activeSeason = club ? await getActiveSeasonByClub(club.id) : null;

      req.session.clubContext = club
        ? {
          clubId: club.id,
          clubName: club.name,
          interfaceColor: club.interface_color || null,
          crestPath: club.crest_path || null,
          productMode: club.product_mode || null,
          activeSeasonId: activeSeason ? activeSeason.id : null,
          activeSeasonName: activeSeason ? activeSeason.name : null,
        }
        : null;
      req.session.clubId = club ? club.id : null;
      req.session.seasonId = activeSeason ? activeSeason.id : null;

      req.context.club = club;
      req.context.activeSeason = activeSeason;
    } else {
      const storedContext = req.session.clubContext;
      req.context.club = storedContext
        ? {
          id: storedContext.clubId,
          name: storedContext.clubName,
          interface_color: storedContext.interfaceColor || null,
          crest_path: storedContext.crestPath || null,
          product_mode: storedContext.productMode || null,
        }
        : null;
      req.context.activeSeason = storedContext && storedContext.activeSeasonId
        ? {
          id: storedContext.activeSeasonId,
          name: storedContext.activeSeasonName,
        }
        : null;
      req.session.clubId = storedContext ? storedContext.clubId : null;
      req.session.seasonId = storedContext ? storedContext.activeSeasonId : null;
    }
  } catch (err) {
    logger.error('Error attaching session club context', {
      type: 'session_context',
      action: 'attach_context_error',
      userId: user ? user.id : null,
      defaultClub: user ? user.default_club : null,
      error: logger.formatError(err),
    });
    req.session.clubContext = null;
    req.session.clubId = null;
    req.session.seasonId = null;
  }

  return next();
}

module.exports = {
  attachSessionContext,
};
