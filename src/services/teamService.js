const { getClubByName } = require('../models/clubModel');
const {
  ensureActiveSeasonForClub,
  getSeasonsByClubId,
  findSeasonById,
} = require('../models/seasonModel');
const { getAllSections, findSectionById } = require('../models/sectionModel');
const { getAllCategories, findCategoryById } = require('../models/categoryModel');
const {
  createTeam,
  findTeamById,
  updateTeam,
  deleteTeam,
  getTeamsByClubId,
} = require('../models/teamModel');
const {
  getPlayersByTeamId,
  getPlayersByTeamIds,
  deleteTeamPlayersByTeamId,
} = require('../models/teamPlayerModel');

function normalizePlayerPreview(player) {
  return {
    id: player.player_id,
    dorsal: player.dorsal || '',
    fullName: `${player.first_name} ${player.last_name}`.trim(),
    position: player.positions || '',
  };
}

async function requireClubForUser(user) {
  if (!user || !user.default_club) {
    return null;
  }
  return getClubByName(user.default_club);
}

async function getActiveSeasonByClub(clubId) {
  if (!clubId) {
    return null;
  }
  return ensureActiveSeasonForClub(clubId);
}

async function getTeamsGroupedBySectionAndCategory(clubId, filters = {}) {
  const teams = await getTeamsByClubId(clubId);
  const filteredTeams = teams.filter((team) => {
    if (filters.section && team.section_name !== filters.section) {
      return false;
    }
    if (filters.category && team.category_name !== filters.category) {
      return false;
    }
    return true;
  });

  const teamIds = filteredTeams.map((team) => team.id);
  const players = await getPlayersByTeamIds(teamIds);
  const previewsByTeam = players.reduce((map, player) => {
    if (!map.has(player.team_id)) {
      map.set(player.team_id, []);
    }
    map.get(player.team_id).push(player);
    return map;
  }, new Map());

  const grouped = {};
  filteredTeams.forEach((team) => {
    if (!grouped[team.section_name]) {
      grouped[team.section_name] = {};
    }
    if (!grouped[team.section_name][team.category_name]) {
      grouped[team.section_name][team.category_name] = [];
    }
    const teamPlayers = previewsByTeam.get(team.id) || [];
    grouped[team.section_name][team.category_name].push({
      ...team,
      player_count: teamPlayers.length,
      player_previews: teamPlayers.slice(0, 6).map(normalizePlayerPreview),
    });
  });

  return grouped;
}

async function countPlayersByTeam(teamId) {
  const players = await getPlayersByTeamId(teamId);
  return players.length;
}

async function getPlayerPreviewsPerTeam(teamId, limit = 6) {
  const players = await getPlayersByTeamId(teamId);
  return players.slice(0, limit).map(normalizePlayerPreview);
}

async function getDefaultTeamOptionsForClub(clubId) {
  if (!clubId) {
    return [];
  }

  const teams = await getTeamsByClubId(clubId);
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    seasonName: team.season_name || '',
    sectionName: team.section_name || '',
    categoryName: team.category_name || '',
    isActiveSeason: Boolean(team.season_is_active),
    label: [
      team.name,
      team.season_name,
      team.category_name,
      team.section_name,
    ].filter(Boolean).join(' · '),
  }));
}

async function getTeamDetail(teamId) {
  const team = await findTeamById(teamId);
  if (!team) {
    return null;
  }
  const players = await getPlayersByTeamId(teamId);
  return {
    ...team,
    players: players.map((player) => ({
      id: player.player_id,
      dorsal: player.dorsal || '',
      first_name: player.first_name,
      last_name: player.last_name,
      full_name: `${player.first_name} ${player.last_name}`.trim(),
      positions: player.positions || '',
      laterality: player.laterality || '',
      birth_year: player.birth_year || null,
    })),
  };
}

async function getTeamFormData(user) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [sections, categories, seasons, activeSeason] = await Promise.all([
    getAllSections(),
    getAllCategories(),
    getSeasonsByClubId(club.id),
    getActiveSeasonByClub(club.id),
  ]);

  return {
    club,
    sections,
    categories,
    seasons,
    activeSeason,
  };
}

async function createTeamForUser(user, payload) {
  const club = await requireClubForUser(user);
  if (!club) {
    throw new Error('CLUB_REQUIRED');
  }

  const team = await createTeam({
    clubId: club.id,
    seasonId: payload.seasonId,
    sectionId: payload.sectionId,
    categoryId: payload.categoryId,
    name: payload.name,
  });
  return team;
}

async function updateTeamForUser(user, teamId, payload) {
  const club = await requireClubForUser(user);
  if (!club) {
    throw new Error('CLUB_REQUIRED');
  }

  const team = await findTeamById(teamId);
  if (!team || team.club_id !== club.id) {
    return 0;
  }

  return updateTeam(teamId, payload);
}

async function deleteTeamForUser(user, teamId) {
  const club = await requireClubForUser(user);
  if (!club) {
    throw new Error('CLUB_REQUIRED');
  }

  const team = await findTeamById(teamId);
  if (!team || team.club_id !== club.id) {
    return 0;
  }

  await deleteTeamPlayersByTeamId(teamId);
  return deleteTeam(teamId);
}

async function validateTeamPayload(user, payload) {
  const club = await requireClubForUser(user);
  if (!club) {
    return 'Debes tener un club activo para gestionar plantillas.';
  }

  if (!payload.name || !payload.name.trim()) {
    return 'El nombre del equipo es obligatorio.';
  }

  const [season, section, category] = await Promise.all([
    findSeasonById(payload.seasonId),
    findSectionById(payload.sectionId),
    findCategoryById(payload.categoryId),
  ]);

  if (!season || season.club_id !== club.id) {
    return 'La temporada seleccionada no es válida.';
  }
  if (!section) {
    return 'La sección seleccionada no es válida.';
  }
  if (!category) {
    return 'La categoría seleccionada no es válida.';
  }

  return null;
}

module.exports = {
  requireClubForUser,
  getActiveSeasonByClub,
  getTeamsGroupedBySectionAndCategory,
  countPlayersByTeam,
  getPlayerPreviewsPerTeam,
  getDefaultTeamOptionsForClub,
  getTeamDetail,
  getTeamFormData,
  createTeamForUser,
  updateTeamForUser,
  deleteTeamForUser,
  validateTeamPayload,
};
