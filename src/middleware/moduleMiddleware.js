const { getRequestClub } = require('./clubScopeMiddleware');
const { isClubModuleEnabled, getClubModuleState } = require('../shared/services/clubModuleService');
const { DEFAULT_CLUB_MODULES, MODULE_KEYS } = require('../shared/constants/moduleKeys');

function requireModule(moduleKey) {
  return async (req, res, next) => {
    const club = getRequestClub(req);

    if (!club || !club.id) {
      if (moduleKey === MODULE_KEYS.SCOUTING_PLAYERS) {
        return next();
      }

      if (req.accepts('json')) {
        return res.status(403).json({
          error: 'MODULE_REQUIRES_ACTIVE_CLUB',
          moduleKey,
        });
      }

      req.flash('error', 'Necesitas un club activo para acceder a este módulo.');
      return res.redirect('/account');
    }

    const enabled = await isClubModuleEnabled(club.id, moduleKey);

    if (enabled) {
      return next();
    }

    const moduleState = await getClubModuleState(club.id);

    if (req.accepts('json')) {
      return res.status(403).json({
        error: 'MODULE_DISABLED',
        moduleKey,
        activeModules: moduleState.activeModuleKeys,
      });
    }

    return res.status(403).render('errors/module-disabled', {
      pageTitle: 'Módulo no disponible',
      moduleKey,
      activeModules: moduleState.activeModuleKeys,
    });
  };
}

async function attachModuleContext(req, res, next) {
  if (!req.context) {
    req.context = {};
  }

  req.context.modules = [];
  req.context.activeModuleKeys = [];

  const club = getRequestClub(req);
  if (!club || !club.id) {
    if (req.session && req.session.user) {
      req.context.modules = DEFAULT_CLUB_MODULES.map((moduleEntry) => ({
        moduleKey: moduleEntry.key,
        enabled: moduleEntry.enabled,
      }));
      req.context.activeModuleKeys = DEFAULT_CLUB_MODULES
        .filter((moduleEntry) => moduleEntry.enabled)
        .map((moduleEntry) => moduleEntry.key);
    }
    return next();
  }

  const moduleState = await getClubModuleState(club.id);
  req.context.modules = moduleState.modules;
  req.context.activeModuleKeys = moduleState.activeModuleKeys;

  return next();
}

module.exports = {
  requireModule,
  attachModuleContext,
};
