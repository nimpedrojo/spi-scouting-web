const { getSeasonsByClubId } = require('../models/seasonModel');

function normalizeSeasonId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

async function resolveSeasonView(clubId, activeSeason = null, requestedSeasonId = null) {
  if (!clubId) {
    return {
      seasons: [],
      activeSeason,
      selectedSeason: activeSeason,
      selectedSeasonId: activeSeason ? activeSeason.id : null,
    };
  }

  const seasons = await getSeasonsByClubId(clubId);
  const normalizedRequestedSeasonId = normalizeSeasonId(requestedSeasonId);
  const selectedSeason = (normalizedRequestedSeasonId
    ? seasons.find((season) => String(season.id) === normalizedRequestedSeasonId)
    : null)
    || (activeSeason ? seasons.find((season) => String(season.id) === String(activeSeason.id)) : null)
    || seasons[0]
    || null;

  return {
    seasons,
    activeSeason,
    selectedSeason,
    selectedSeasonId: selectedSeason ? selectedSeason.id : null,
  };
}

module.exports = {
  resolveSeasonView,
};
