const { getAllClubs, getClubById, getClubByName } = require('../models/clubModel');
const { getAllUsers } = require('../models/userModel');
const { getAllPlayers } = require('../models/playerModel');
const { getAllReports } = require('../models/reportModel');
const { getRecommendationsByClub } = require('../models/clubRecommendationModel');
const { getTeamsByClubId } = require('../models/teamModel');
const { getSeasonsByClubId } = require('../models/seasonModel');
const { buildNextSeasonSuggestion } = require('./seasonAdminService');
const {
  getClubModules,
  getClubModulePresets,
} = require('../shared/services/clubModuleService');
const { getPlatformProductSettings, resolveEffectiveProductMode } = require('../shared/services/productModeService');

async function resolveAdminClub(req, explicitClubId = null) {
  const isSuperAdmin = req.session.user && req.session.user.role === 'superadmin';
  const requestedClubId = explicitClubId
    || (req.query ? req.query.club_id : null)
    || (req.body ? req.body.club_id : null)
    || null;

  if (requestedClubId) {
    const club = await getClubById(requestedClubId);
    if (club && (isSuperAdmin || club.name === req.session.user.default_club)) {
      return club;
    }
  }

  if (isSuperAdmin) {
    return null;
  }

  if (req.session.user && req.session.user.default_club) {
    const club = await getClubByName(req.session.user.default_club);
    if (club) {
      return club;
    }

    return {
      id: null,
      name: req.session.user.default_club,
      code: null,
    };
  }

  return null;
}

async function getClubAdminData(club) {
  if (!club) {
    return null;
  }

  const [users, players, reports, recommendations, v2Teams, seasons, modules] = await Promise.all([
    getAllUsers(club.name),
    getAllPlayers(club.name),
    getAllReports(club.name),
    getRecommendationsByClub(club.name),
    getTeamsByClubId(club.id),
    getSeasonsByClubId(club.id),
    getClubModules(club.id),
  ]);
  const productMode = await resolveEffectiveProductMode(club);
  const platformProductSettings = await getPlatformProductSettings();

  const moduleSummary = {
    total: modules.length,
    active: modules.filter((moduleEntry) => moduleEntry.enabled).length,
    inactive: modules.filter((moduleEntry) => !moduleEntry.enabled).length,
  };

  return {
    club,
    users,
    players,
    reports,
    recommendations,
    v2Teams,
    seasons,
    nextSeasonSuggestion: buildNextSeasonSuggestion(seasons),
    modules,
    moduleSummary,
    modulePresets: getClubModulePresets(),
    productMode,
    platformProductSettings,
  };
}

async function getClubAdminOptions(req) {
  if (!req.session.user || req.session.user.role !== 'superadmin') {
    return [];
  }
  return getAllClubs();
}

module.exports = {
  resolveAdminClub,
  getClubAdminData,
  getClubAdminOptions,
};
