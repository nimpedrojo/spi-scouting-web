const {
  createSeason,
  getSeasonsByClubId,
  getNextSeasonName,
  setActiveSeason,
} = require('../models/seasonModel');
const { createTeam, getTeamsByClubId } = require('../models/teamModel');

function buildNextSeasonSuggestion(seasons = []) {
  if (!Array.isArray(seasons) || !seasons.length) {
    return getNextSeasonName();
  }

  const activeSeason = seasons.find((season) => Boolean(season.is_active));
  if (activeSeason && activeSeason.name) {
    return getNextSeasonName(activeSeason.name);
  }

  const ordered = [...seasons].sort((left, right) => String(right.name || '').localeCompare(String(left.name || ''), 'es'));
  return getNextSeasonName(ordered[0] ? ordered[0].name : '');
}

async function createSeasonForClub(clubId, payload = {}) {
  const seasons = await getSeasonsByClubId(clubId);
  const normalizedName = String(payload.name || '').trim();
  const duplicateSeason = seasons.find((season) => season.name === normalizedName);

  if (!normalizedName) {
    return {
      errors: ['El nombre de la temporada es obligatorio.'],
    };
  }

  if (duplicateSeason) {
    return {
      errors: ['Ya existe una temporada con ese nombre para el club.'],
    };
  }

  const sourceSeasonId = payload.copyStructureFromSeasonId
    ? String(payload.copyStructureFromSeasonId).trim()
    : '';

  const sourceSeason = sourceSeasonId
    ? seasons.find((season) => String(season.id) === sourceSeasonId)
    : null;

  if (sourceSeasonId && !sourceSeason) {
    return {
      errors: ['La temporada base seleccionada no es válida.'],
    };
  }

  const createdSeason = await createSeason({
    clubId,
    name: normalizedName,
    isActive: Boolean(payload.activate),
  });

  let copiedTeams = 0;
  if (sourceSeason) {
    const teams = await getTeamsByClubId(clubId);
    const sourceTeams = teams.filter((team) => String(team.season_id) === String(sourceSeason.id));

    // eslint-disable-next-line no-restricted-syntax
    for (const team of sourceTeams) {
      // eslint-disable-next-line no-await-in-loop
      await createTeam({
        clubId,
        seasonId: createdSeason.id,
        sectionId: team.section_id,
        categoryId: team.category_id,
        name: team.name,
        source: team.source || null,
        externalId: team.external_id || null,
      });
      copiedTeams += 1;
    }
  }

  return {
    season: createdSeason,
    copiedTeams,
  };
}

async function activateSeasonForClub(clubId, seasonId) {
  const seasons = await getSeasonsByClubId(clubId);
  const targetSeason = seasons.find((season) => String(season.id) === String(seasonId || ''));

  if (!targetSeason) {
    return {
      errors: ['La temporada seleccionada no es válida para el club.'],
    };
  }

  const updated = await setActiveSeason(clubId, targetSeason.id);
  if (!updated) {
    return {
      errors: ['No se ha podido activar la temporada seleccionada.'],
    };
  }

  return {
    season: targetSeason,
  };
}

module.exports = {
  buildNextSeasonSuggestion,
  createSeasonForClub,
  activateSeasonForClub,
};
