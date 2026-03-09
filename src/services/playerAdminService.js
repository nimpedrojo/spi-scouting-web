const { getClubByName } = require('../models/clubModel');
const {
  insertPlayer,
  updatePlayer,
} = require('../models/playerModel');
const {
  getTeamsByClubId,
  findTeamById,
} = require('../models/teamModel');
const {
  upsertTeamPlayer,
  deleteTeamPlayersByPlayerId,
} = require('../models/teamPlayerModel');

function normalizeTeamName(teamName) {
  return teamName && teamName.trim() ? teamName.trim() : null;
}

function matchesTeamName(team, teamName) {
  return team.name.trim().toLowerCase() === teamName.trim().toLowerCase();
}

async function resolveTeamAssignment(clubName, teamName, teamId = null) {
  if (teamId) {
    const selectedTeam = await findTeamById(teamId);
    if (selectedTeam && (!clubName || selectedTeam.club_name === clubName)) {
      return {
        teamName: selectedTeam.name,
        teamId: selectedTeam.id,
      };
    }
  }

  const normalizedTeamName = normalizeTeamName(teamName);
  if (!clubName || !normalizedTeamName) {
    return {
      teamName: normalizedTeamName,
      teamId: null,
    };
  }

  const club = await getClubByName(clubName);
  if (!club) {
    return {
      teamName: normalizedTeamName,
      teamId: null,
    };
  }

  const teams = await getTeamsByClubId(club.id);
  const exactActiveMatches = teams.filter(
    (team) => team.season_is_active && matchesTeamName(team, normalizedTeamName),
  );

  if (exactActiveMatches.length === 1) {
    return {
      teamName: exactActiveMatches[0].name,
      teamId: exactActiveMatches[0].id,
    };
  }

  const exactMatches = teams.filter((team) => matchesTeamName(team, normalizedTeamName));
  if (exactMatches.length === 1) {
    return {
      teamName: exactMatches[0].name,
      teamId: exactMatches[0].id,
    };
  }

  return {
    teamName: normalizedTeamName,
    teamId: null,
  };
}

async function createPlayerWithAssignment(payload) {
  const clubRecord = payload.club ? await getClubByName(payload.club) : null;
  const assignment = await resolveTeamAssignment(payload.club, payload.team, payload.teamId || null);
  const playerId = await insertPlayer({
    ...payload,
    clubId: clubRecord ? clubRecord.id : null,
    team: assignment.teamName,
    currentTeamId: assignment.teamId,
  });

  if (assignment.teamId) {
    await upsertTeamPlayer({
      teamId: assignment.teamId,
      playerId,
      dorsal: payload.dorsal || null,
      positions: payload.positions || null,
    });
  }

  return {
    playerId,
    assignment,
  };
}

async function updatePlayerWithAssignment(playerId, payload) {
  const clubRecord = payload.club ? await getClubByName(payload.club) : null;
  const assignment = await resolveTeamAssignment(payload.club, payload.team, payload.teamId || null);

  const affected = await updatePlayer(playerId, {
    ...payload,
    clubId: clubRecord ? clubRecord.id : null,
    team: assignment.teamName,
    currentTeamId: assignment.teamId,
  });

  if (!affected) {
    return {
      affected,
      assignment,
    };
  }

  await deleteTeamPlayersByPlayerId(playerId);

  if (assignment.teamId) {
    await upsertTeamPlayer({
      teamId: assignment.teamId,
      playerId,
      dorsal: payload.dorsal || null,
      positions: payload.positions || null,
    });
  }

  return {
    affected,
    assignment,
  };
}

module.exports = {
  resolveTeamAssignment,
  createPlayerWithAssignment,
  updatePlayerWithAssignment,
};
