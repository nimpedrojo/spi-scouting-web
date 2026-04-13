const { findTeamById } = require('../models/teamModel');
const { getPlayersByTeamId } = require('../models/teamPlayerModel');

function isPrivilegedUser(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'superadmin'));
}

function isScopedTeamUser(user) {
  return Boolean(user && user.role === 'user' && user.default_team_id);
}

async function getActiveTeamScope(user) {
  if (!isScopedTeamUser(user)) {
    return null;
  }

  return findTeamById(user.default_team_id);
}

async function canAccessTeam(user, teamId) {
  if (!teamId) {
    return false;
  }

  if (isPrivilegedUser(user)) {
    return true;
  }

  return Boolean(isScopedTeamUser(user) && String(user.default_team_id) === String(teamId));
}

async function getAllowedPlayersForUser(user) {
  if (!user) {
    return [];
  }

  if (isPrivilegedUser(user) || !user.default_team_id) {
    return [];
  }

  return getPlayersByTeamId(user.default_team_id);
}

async function canAccessPlayer(user, playerId) {
  if (!playerId) {
    return false;
  }

  if (isPrivilegedUser(user)) {
    return true;
  }

  if (!isScopedTeamUser(user)) {
    return false;
  }

  const players = await getAllowedPlayersForUser(user);
  return players.some((player) => String(player.player_id) === String(playerId));
}

async function filterTeamsForUser(user, teams) {
  if (!Array.isArray(teams)) {
    return [];
  }

  if (isPrivilegedUser(user) || !isScopedTeamUser(user)) {
    return teams;
  }

  return teams.filter((team) => String(team.id) === String(user.default_team_id));
}

async function filterPlayersForUser(user, players) {
  if (!Array.isArray(players)) {
    return [];
  }

  if (isPrivilegedUser(user) || !isScopedTeamUser(user)) {
    return players;
  }

  const allowedPlayers = await getAllowedPlayersForUser(user);
  const allowedIds = new Set(allowedPlayers.map((player) => String(player.player_id)));

  return players.filter((player) => allowedIds.has(String(player.id || player.player_id)));
}

function canManageMultipleTeams(user) {
  return isPrivilegedUser(user);
}

module.exports = {
  isPrivilegedUser,
  isScopedTeamUser,
  getActiveTeamScope,
  canAccessTeam,
  canAccessPlayer,
  getAllowedPlayersForUser,
  filterTeamsForUser,
  filterPlayersForUser,
  canManageMultipleTeams,
};
