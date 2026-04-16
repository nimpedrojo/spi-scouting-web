const { getTeamsByClubId, findTeamById } = require('../../../models/teamModel');
const {
  findScoutingTeamOpponentByName,
  createScoutingTeamOpponent,
} = require('../models/scoutingTeamOpponentModel');
const {
  listScoutingTeamReportsByClub,
  findScoutingTeamReportById,
  createScoutingTeamReport,
  updateScoutingTeamReport,
  deleteScoutingTeamReport,
  countScoutingTeamReportsByClub,
} = require('../models/scoutingTeamReportModel');

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

async function resolveOpponentForClub(clubId, opponentName, countryName = null) {
  const normalizedName = normalizeOptionalText(opponentName);

  if (!normalizedName) {
    return null;
  }

  const existing = await findScoutingTeamOpponentByName(clubId, normalizedName);
  if (existing) {
    return existing;
  }

  return createScoutingTeamOpponent({
    clubId,
    name: normalizedName,
    countryName: normalizeOptionalText(countryName),
  });
}

function buildScoutingTeamsFormData(body = {}) {
  return {
    opponent_name: body.opponent_name || '',
    opponent_country_name: body.opponent_country_name || '',
    own_team_id: body.own_team_id || '',
    match_date: body.match_date || '',
    competition: body.competition || '',
    system_shape: body.system_shape || '',
    style_in_possession: body.style_in_possession || '',
    style_out_of_possession: body.style_out_of_possession || '',
    transitions: body.transitions || '',
    set_pieces: body.set_pieces || '',
    strengths: body.strengths || '',
    weaknesses: body.weaknesses || '',
    key_players: body.key_players || '',
    general_observations: body.general_observations || '',
  };
}

async function getScoutingTeamsIndexData(clubId, filters = {}) {
  const [reports, reportCount] = await Promise.all([
    listScoutingTeamReportsByClub(clubId, filters),
    countScoutingTeamReportsByClub(clubId),
  ]);

  return {
    reports,
    reportCount,
  };
}

async function getScoutingTeamsFormOptions(clubId) {
  const teams = await getTeamsByClubId(clubId);
  return teams.map((team) => ({
    id: team.id,
    label: [team.name, team.category_name, team.section_name, team.season_name]
      .filter(Boolean)
      .join(' · '),
  }));
}

async function createScoutingTeamsReport(clubId, userId, body) {
  const opponent = await resolveOpponentForClub(
    clubId,
    body.opponent_name,
    body.opponent_country_name,
  );

  if (!opponent) {
    const error = new Error('OPPONENT_NAME_REQUIRED');
    error.code = 'OPPONENT_NAME_REQUIRED';
    throw error;
  }

  let ownTeamId = normalizeOptionalText(body.own_team_id);
  if (ownTeamId) {
    const ownTeam = await findTeamById(ownTeamId);
    if (!ownTeam || Number(ownTeam.club_id) !== Number(clubId)) {
      const error = new Error('INVALID_TEAM_SCOPE');
      error.code = 'INVALID_TEAM_SCOPE';
      throw error;
    }
    ownTeamId = ownTeam.id;
  }

  return createScoutingTeamReport({
    clubId,
    ownTeamId,
    opponentId: opponent.id,
    createdBy: userId,
    matchDate: normalizeOptionalText(body.match_date),
    competition: normalizeOptionalText(body.competition),
    systemShape: normalizeOptionalText(body.system_shape),
    styleInPossession: normalizeOptionalText(body.style_in_possession),
    styleOutOfPossession: normalizeOptionalText(body.style_out_of_possession),
    transitions: normalizeOptionalText(body.transitions),
    setPieces: normalizeOptionalText(body.set_pieces),
    strengths: normalizeOptionalText(body.strengths),
    weaknesses: normalizeOptionalText(body.weaknesses),
    keyPlayers: normalizeOptionalText(body.key_players),
    generalObservations: normalizeOptionalText(body.general_observations),
  });
}

async function updateScoutingTeamsReport(clubId, reportId, body) {
  const existingReport = await findScoutingTeamReportById(clubId, reportId);
  if (!existingReport) {
    return null;
  }

  const opponent = await resolveOpponentForClub(
    clubId,
    body.opponent_name,
    body.opponent_country_name,
  );

  if (!opponent) {
    const error = new Error('OPPONENT_NAME_REQUIRED');
    error.code = 'OPPONENT_NAME_REQUIRED';
    throw error;
  }

  let ownTeamId = normalizeOptionalText(body.own_team_id);
  if (ownTeamId) {
    const ownTeam = await findTeamById(ownTeamId);
    if (!ownTeam || Number(ownTeam.club_id) !== Number(clubId)) {
      const error = new Error('INVALID_TEAM_SCOPE');
      error.code = 'INVALID_TEAM_SCOPE';
      throw error;
    }
    ownTeamId = ownTeam.id;
  }

  return updateScoutingTeamReport(clubId, reportId, {
    ownTeamId,
    opponentId: opponent.id,
    matchDate: normalizeOptionalText(body.match_date),
    competition: normalizeOptionalText(body.competition),
    systemShape: normalizeOptionalText(body.system_shape),
    styleInPossession: normalizeOptionalText(body.style_in_possession),
    styleOutOfPossession: normalizeOptionalText(body.style_out_of_possession),
    transitions: normalizeOptionalText(body.transitions),
    setPieces: normalizeOptionalText(body.set_pieces),
    strengths: normalizeOptionalText(body.strengths),
    weaknesses: normalizeOptionalText(body.weaknesses),
    keyPlayers: normalizeOptionalText(body.key_players),
    generalObservations: normalizeOptionalText(body.general_observations),
  });
}

module.exports = {
  buildScoutingTeamsFormData,
  getScoutingTeamsIndexData,
  getScoutingTeamsFormOptions,
  findScoutingTeamReportById,
  createScoutingTeamsReport,
  updateScoutingTeamsReport,
  deleteScoutingTeamReport,
};
