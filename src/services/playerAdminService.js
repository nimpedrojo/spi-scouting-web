const { getClubByName } = require('../models/clubModel');
const {
  getAllPlayers,
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
const {
  isPrivilegedUser,
} = require('./userScopeService');

const DEFAULT_PAGE_SIZE = 25;
const ALLOWED_SORT_FIELDS = new Set([
  'id',
  'first_name',
  'last_name',
  'team',
  'dorsal',
  'birth_year',
  'laterality',
  'created_at',
]);

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

function normalizePlayerListQuery(query = {}) {
  const page = Number.parseInt(query.page, 10);
  const sortField = ALLOWED_SORT_FIELDS.has(query.sort) ? query.sort : 'created_at';
  const sortDirection = query.dir === 'asc' ? 'asc' : 'desc';
  const birthYear = query.birth_year && String(query.birth_year).trim()
    ? String(query.birth_year).trim()
    : '';

  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    teamId: query.team_id && String(query.team_id).trim() ? String(query.team_id).trim() : '',
    laterality: query.laterality && String(query.laterality).trim()
      ? String(query.laterality).trim().toUpperCase()
      : '',
    birthYear,
    sort: sortField,
    dir: sortDirection,
  };
}

function filterPlayersByQuery(players, filters) {
  return (players || []).filter((player) => {
    if (filters.teamId && String(player.current_team_id || '') !== String(filters.teamId)) {
      return false;
    }

    if (
      filters.laterality
      && String(player.laterality || '').trim().toUpperCase() !== filters.laterality
    ) {
      return false;
    }

    if (
      filters.birthYear
      && String(player.birth_year || '').trim() !== String(filters.birthYear)
    ) {
      return false;
    }

    return true;
  });
}

function compareValues(left, right) {
  if (left === right) {
    return 0;
  }

  if (left === '' || left === null || left === undefined) {
    return 1;
  }

  if (right === '' || right === null || right === undefined) {
    return -1;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right), 'es', { sensitivity: 'base' });
}

function getSortableValue(player, sortField) {
  switch (sortField) {
    case 'id':
      return Number(player.id || 0);
    case 'first_name':
      return player.first_name || '';
    case 'last_name':
      return player.last_name || '';
    case 'team':
      return player.relational_team_name || player.team || '';
    case 'dorsal':
      return Number.parseInt(player.dorsal, 10) || 0;
    case 'birth_year':
      return Number.parseInt(player.birth_year, 10) || 0;
    case 'laterality':
      return player.laterality || '';
    case 'created_at':
    default:
      return player.created_at ? new Date(player.created_at).getTime() : 0;
  }
}

function sortPlayers(players, sortField, sortDirection) {
  const sorted = [...(players || [])];
  sorted.sort((left, right) => {
    const primary = compareValues(
      getSortableValue(left, sortField),
      getSortableValue(right, sortField),
    );

    if (primary !== 0) {
      return sortDirection === 'asc' ? primary : -primary;
    }

    const lastName = compareValues(left.last_name || '', right.last_name || '');
    if (lastName !== 0) {
      return lastName;
    }

    return compareValues(left.first_name || '', right.first_name || '');
  });
  return sorted;
}

function paginatePlayers(players, page, pageSize = DEFAULT_PAGE_SIZE) {
  const totalItems = players.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;

  return {
    items: players.slice(startIndex, startIndex + pageSize),
    pagination: {
      page: currentPage,
      pageSize,
      totalItems,
      totalPages,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
      startItem: totalItems ? startIndex + 1 : 0,
      endItem: Math.min(startIndex + pageSize, totalItems),
    },
  };
}

function buildDistinctOptions(players, fieldName, transform = (value) => value) {
  return Array.from(new Set(
    (players || [])
      .map((player) => player[fieldName])
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(transform),
  ));
}

async function getVisiblePlayersForUser(user) {
  const isSuperAdmin = user && user.role === 'superadmin';
  const clubFilter = isSuperAdmin ? null : user.default_club || null;
  let players = await getAllPlayers(clubFilter);

  if (!isPrivilegedUser(user) && user && user.default_team_id) {
    players = players.filter((player) => String(player.current_team_id) === String(user.default_team_id));
  }

  return players;
}

async function getPlayerListData(user, rawQuery = {}) {
  const filters = normalizePlayerListQuery(rawQuery);
  const allVisiblePlayers = await getVisiblePlayersForUser(user);
  const filteredPlayers = filterPlayersByQuery(allVisiblePlayers, filters);
  const sortedPlayers = sortPlayers(filteredPlayers, filters.sort, filters.dir);
  const paginated = paginatePlayers(sortedPlayers, filters.page);

  const teamOptions = Array.from(new Map(
    allVisiblePlayers
      .filter((player) => player.current_team_id && (player.relational_team_name || player.team))
      .map((player) => [
        String(player.current_team_id),
        {
          id: String(player.current_team_id),
          name: player.relational_team_name || player.team,
        },
      ]),
  ).values()).sort((left, right) => left.name.localeCompare(right.name, 'es'));

  const lateralityOptions = buildDistinctOptions(
    allVisiblePlayers,
    'laterality',
    (value) => String(value).trim().toUpperCase(),
  ).sort((a, b) => a.localeCompare(b, 'es'));

  const birthYearOptions = buildDistinctOptions(
    allVisiblePlayers,
    'birth_year',
    (value) => String(value).trim(),
  ).sort((a, b) => Number(b) - Number(a));

  return {
    players: paginated.items,
    filters,
    sort: {
      field: filters.sort,
      direction: filters.dir,
    },
    pagination: paginated.pagination,
    filterOptions: {
      teams: teamOptions,
      lateralities: lateralityOptions,
      birthYears: birthYearOptions,
    },
  };
}

module.exports = {
  resolveTeamAssignment,
  createPlayerWithAssignment,
  updatePlayerWithAssignment,
  getVisiblePlayersForUser,
  getPlayerListData,
};
