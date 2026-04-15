const { getClubByName, getClubById } = require('../models/clubModel');
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
const {
  countReportsByClubAndTeam,
  listRecentReportsByClubAndTeam,
} = require('../models/reportModel');
const {
  countEvaluationsByTeam,
  listRecentEvaluationsByTeam,
} = require('../models/evaluationModel');
const {
  countScoutingTeamReportsByOwnTeam,
  listRecentScoutingTeamReportsByOwnTeam,
} = require('../modules/scoutingTeams/models/scoutingTeamReportModel');
const { MODULE_KEYS } = require('../shared/constants/moduleKeys');

function normalizePlayerPreview(player) {
  return {
    id: player.player_id,
    dorsal: player.dorsal || '',
    fullName: `${player.first_name} ${player.last_name}`.trim(),
    position: player.positions || '',
  };
}

function normalizeLaterality(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (!normalized) {
    return 'unknown';
  }

  if (['DER', 'DERECHO', 'DIESTRO', 'RIGHT'].includes(normalized)) {
    return 'right';
  }

  if (['IZQ', 'IZQUIERDO', 'ZURDO', 'LEFT'].includes(normalized)) {
    return 'left';
  }

  if (['AMB', 'AMBIDIESTRO', 'BOTH'].includes(normalized)) {
    return 'both';
  }

  return 'unknown';
}

const POSITION_ALIAS_MAP = {
  PORTERO: 'POR',
  POR: 'POR',
  DC: 'CENTRAL',
  DFC: 'CENTRAL',
  CENTRAL: 'CENTRAL',
  LD: 'LD',
  LI: 'LI',
  MC: 'MC',
  MCD: 'MC',
  MCO: 'MP',
  MP: 'MP',
  MEDIAPUNTA: 'MP',
  ID: 'ID',
  II: 'II',
  ED: 'ED',
  EI: 'EI',
  'EXTREMO DERECHO': 'ED',
  'EXTREMO IZQUIERDO': 'EI',
  DEL: 'DEL',
  DELANTERO: 'DEL',
};

const SUPPORTED_POSITIONS = ['POR', 'LI', 'CENTRAL', 'LD', 'MC', 'II', 'MP', 'ID', 'EI', 'DEL', 'ED'];

function normalizePositions(positionsValue) {
  if (!positionsValue) {
    return [];
  }

  return Array.from(new Set(String(positionsValue)
    .split(',')
    .map((position) => position.trim().toUpperCase())
    .map((position) => POSITION_ALIAS_MAP[position] || position)
    .filter((position) => SUPPORTED_POSITIONS.includes(position))));
}

function buildCoverageSummary(players) {
  const counts = SUPPORTED_POSITIONS.reduce((acc, position) => {
    acc[position] = 0;
    return acc;
  }, {});

  players.forEach((player) => {
    normalizePositions(player.positions).forEach((position) => {
      counts[position] += 1;
    });
  });

  return SUPPORTED_POSITIONS
    .map((position) => ({
      code: position,
      count: counts[position],
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function buildLineDistribution(players) {
  const lines = {
    goalkeepers: 0,
    defense: 0,
    midfield: 0,
    attack: 0,
  };

  players.forEach((player) => {
    const primaryPosition = normalizePositions(player.positions)[0];

    if (!primaryPosition) {
      return;
    }

    if (primaryPosition === 'POR') {
      lines.goalkeepers += 1;
      return;
    }

    if (['LI', 'CENTRAL', 'LD'].includes(primaryPosition)) {
      lines.defense += 1;
      return;
    }

    if (['MC', 'II', 'MP', 'ID'].includes(primaryPosition)) {
      lines.midfield += 1;
      return;
    }

    if (['EI', 'DEL', 'ED'].includes(primaryPosition)) {
      lines.attack += 1;
    }
  });

  return lines;
}

function buildBirthYearSummary(players) {
  const validYears = players
    .map((player) => Number(player.birth_year))
    .filter((year) => Number.isInteger(year) && year > 1900);

  if (!validYears.length) {
    return {
      label: 'Sin dato',
      detail: 'Año base no disponible',
    };
  }

  const counts = validYears.reduce((acc, year) => {
    acc[year] = (acc[year] || 0) + 1;
    return acc;
  }, {});

  const sortedYears = Object.keys(counts)
    .map(Number)
    .sort((a, b) => counts[b] - counts[a] || b - a);

  const dominantYear = sortedYears[0];
  const minYear = Math.min(...validYears);
  const maxYear = Math.max(...validYears);

  return {
    label: String(dominantYear),
    detail: minYear === maxYear ? 'Toda la plantilla comparte año' : `Rango ${minYear}-${maxYear}`,
  };
}

function buildLateralitySummary(players) {
  const counts = {
    right: 0,
    left: 0,
    both: 0,
    unknown: 0,
  };

  players.forEach((player) => {
    counts[normalizeLaterality(player.laterality)] += 1;
  });

  const total = players.length || 1;
  const rightEnd = Math.round((counts.right / total) * 360);
  const leftEnd = rightEnd + Math.round((counts.left / total) * 360);
  const bothEnd = leftEnd + Math.round((counts.both / total) * 360);

  return {
    counts,
    chartStyle: `conic-gradient(
      #1d4ed8 0deg ${rightEnd}deg,
      #16a34a ${rightEnd}deg ${leftEnd}deg,
      #f59e0b ${leftEnd}deg ${bothEnd}deg,
      #cbd5e1 ${bothEnd}deg 360deg
    )`,
  };
}

function buildTeamCardSummary(players) {
  const coverageSummary = buildCoverageSummary(players);
  const lineDistribution = buildLineDistribution(players);
  const birthYearSummary = buildBirthYearSummary(players);
  const lateralitySummary = buildLateralitySummary(players);

  return {
    coverageLabel: `${coverageSummary.length}/${SUPPORTED_POSITIONS.length}`,
    coverageDetail: coverageSummary.slice(0, 4).map((entry) => entry.code).join(', ') || 'Sin posiciones',
    birthYearLabel: birthYearSummary.label,
    birthYearDetail: birthYearSummary.detail,
    lineDistribution,
    laterality: lateralitySummary,
  };
}

async function requireClubForUser(user, options = {}) {
  if (!user) {
    return null;
  }

  if (user.role === 'superadmin') {
    if (!options.clubId) {
      return null;
    }
    return getClubById(options.clubId);
  }

  if (!user.default_club) {
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
      summary: buildTeamCardSummary(teamPlayers),
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
  const normalizedPlayers = players.map((player) => {
    const positionsList = normalizePositions(player.positions || '');
    return {
      id: player.player_id,
      dorsal: player.dorsal || '',
      first_name: player.first_name,
      last_name: player.last_name,
      full_name: `${player.first_name} ${player.last_name}`.trim(),
      positions: player.positions || '',
      positions_list: positionsList,
      primary_position: positionsList[0] || '',
      laterality: player.laterality || '',
      birth_year: player.birth_year || null,
    };
  });

  return {
    ...team,
    players: normalizedPlayers,
    coverageSummary: buildCoverageSummary(normalizedPlayers),
  };
}

async function getTeamWorkspaceData(teamId, options = {}) {
  const team = await getTeamDetail(teamId);
  if (!team) {
    return null;
  }

  const activeModuleKeys = Array.isArray(options.activeModuleKeys) ? options.activeModuleKeys : [];
  const scoutingPlayersEnabled = activeModuleKeys.includes(MODULE_KEYS.SCOUTING_PLAYERS);
  const planningEnabled = activeModuleKeys.includes(MODULE_KEYS.PLANNING);
  const scoutingTeamsEnabled = activeModuleKeys.includes(MODULE_KEYS.SCOUTING_TEAMS);

  const [
    evaluationCount,
    scoutingPlayerReportCount,
    scoutingTeamReportCount,
    recentEvaluations,
    recentReports,
    recentScoutingTeamReports,
  ] = await Promise.all([
    scoutingPlayersEnabled ? countEvaluationsByTeam(team.club_id, team.id) : Promise.resolve(0),
    scoutingPlayersEnabled
      ? countReportsByClubAndTeam(team.club_name, team.name)
      : Promise.resolve(0),
    scoutingTeamsEnabled
      ? countScoutingTeamReportsByOwnTeam(team.club_id, team.id)
      : Promise.resolve(0),
    scoutingPlayersEnabled
      ? listRecentEvaluationsByTeam(team.club_id, team.id, 3)
      : Promise.resolve([]),
    scoutingPlayersEnabled
      ? listRecentReportsByClubAndTeam(team.club_name, team.name, 3)
      : Promise.resolve([]),
    scoutingTeamsEnabled
      ? listRecentScoutingTeamReportsByOwnTeam(team.club_id, team.id, 3)
      : Promise.resolve([]),
  ]);

  return {
    ...team,
    workspaceSummary: {
      playerCount: team.players.length,
      evaluationCount,
      scoutingPlayerReportCount,
      scoutingTeamReportCount,
      planningAvailable: planningEnabled,
    },
    recentActivity: {
      evaluations: recentEvaluations.map((entry) => ({
        id: entry.id,
        date: entry.evaluation_date,
        title: entry.title || 'Evaluación manual',
        playerName: `${entry.first_name} ${entry.last_name}`.trim(),
        authorName: entry.author_name || '',
        overallScore: Number(entry.overall_score || 0),
      })),
      reports: recentReports.map((entry) => ({
        id: entry.id,
        date: entry.created_at,
        title: `${entry.player_name} ${entry.player_surname}`.trim(),
        authorName: entry.created_by_name || '',
        overallRating: entry.overall_rating != null ? Number(entry.overall_rating) : null,
      })),
      scoutingTeams: recentScoutingTeamReports.map((entry) => ({
        id: entry.id,
        date: entry.matchDate || entry.createdAt,
        title: entry.opponentName || 'Rival',
        competition: entry.competition || '',
        authorName: entry.authorName || '',
      })),
    },
  };
}

async function getTeamFormData(user, options = {}) {
  const club = await requireClubForUser(user, options);
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
  const club = await requireClubForUser(user, payload || {});
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
  const club = await requireClubForUser(user, payload || {});
  if (!club) {
    throw new Error('CLUB_REQUIRED');
  }

  const team = await findTeamById(teamId);
  if (!team || team.club_id !== club.id) {
    return 0;
  }

  return updateTeam(teamId, payload);
}

async function deleteTeamForUser(user, teamId, options = {}) {
  const club = await requireClubForUser(user, options);
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
  const club = await requireClubForUser(user, payload || {});
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
  getTeamWorkspaceData,
  getTeamFormData,
  createTeamForUser,
  updateTeamForUser,
  deleteTeamForUser,
  validateTeamPayload,
};
