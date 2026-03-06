const { getSeasonsByClubId } = require('../models/seasonModel');
const { getAllSections } = require('../models/sectionModel');
const { getAllCategories } = require('../models/categoryModel');
const { getTeamsByClubId } = require('../models/teamModel');
const { requireClubForUser, getActiveSeasonByClub } = require('./teamService');
const { getPlayersForComparison, getPlayersAnalyticsBatch } = require('./playerAnalyticsService');

function normalizeSelectedPlayers(playerIds) {
  const selected = Array.isArray(playerIds) ? playerIds : [playerIds];
  return selected
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))
    .slice(0, 4);
}

function buildRadarChartData(playersComparison) {
  const labels = playersComparison.length ? playersComparison[0].averageByArea.map((item) => item.label) : [];
  const palette = [
    { border: '#0f3d2e', background: 'rgba(15, 61, 46, 0.16)' },
    { border: '#0284c7', background: 'rgba(2, 132, 199, 0.16)' },
    { border: '#f59e0b', background: 'rgba(245, 158, 11, 0.16)' },
    { border: '#7c3aed', background: 'rgba(124, 58, 237, 0.16)' },
  ];

  return {
    labels,
    datasets: playersComparison.map((player, index) => ({
      label: player.summary.fullName,
      data: player.averageByArea.map((item) => Number(item.average)),
      borderColor: palette[index].border,
      backgroundColor: palette[index].background,
      pointBackgroundColor: palette[index].border,
      pointBorderColor: '#ffffff',
    })),
  };
}

function buildMetricComparisonTable(playersComparison) {
  const rows = [];
  const firstPlayer = playersComparison[0];
  if (!firstPlayer) {
    return rows;
  }

  firstPlayer.areaEntries.forEach((area) => {
    area.metrics.forEach((metric) => {
      const values = playersComparison.map((player) => {
        const playerArea = player.areaEntries.find((entry) => entry.key === area.key);
        const playerMetric = playerArea
          ? playerArea.metrics.find((entry) => entry.key === metric.key)
          : null;
        return {
          playerId: player.summary.id,
          playerName: player.summary.fullName,
          value: playerMetric ? Number(playerMetric.average) : 0,
        };
      });
      const bestValue = Math.max(...values.map((item) => item.value));
      rows.push({
        areaKey: area.key,
        areaLabel: area.label,
        metricKey: metric.key,
        metricLabel: metric.label,
        values: values.map((item) => ({
          ...item,
          isBest: item.value === bestValue,
        })),
      });
    });
  });

  return rows;
}

function detectLowSampleWarning(playersComparison) {
  if (!playersComparison.length) {
    return null;
  }
  const totals = playersComparison.map((player) => player.history.totalEvaluations);
  const max = Math.max(...totals);
  if (max < 2) {
    return null;
  }

  const lowSamplePlayers = playersComparison.filter((player) => player.history.totalEvaluations < Math.ceil(max / 2));
  if (!lowSamplePlayers.length) {
    return null;
  }

  return `Atencion: ${lowSamplePlayers.map((player) => player.summary.fullName).join(', ')} tiene menos evaluaciones que el resto de la comparativa.`;
}

async function getComparisonFilters(user, selectedFilters = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [seasons, sections, categories, teams, players, activeSeason] = await Promise.all([
    getSeasonsByClubId(club.id),
    getAllSections(),
    getAllCategories(),
    getTeamsByClubId(club.id),
    getPlayersForComparison(club.id, selectedFilters),
    getActiveSeasonByClub(club.id),
  ]);

  return {
    club,
    seasons,
    sections,
    categories,
    teams,
    players,
    activeSeason,
  };
}

async function buildComparison(user, payload = {}) {
  const filters = {
    seasonId: payload.seasonId || null,
    section: payload.section || null,
    category: payload.category || null,
    teamId: payload.teamId || null,
  };

  const filterOptions = await getComparisonFilters(user, filters);
  if (!filterOptions) {
    return null;
  }

  const selectedPlayerIds = normalizeSelectedPlayers(payload.playerIds || []);
  if (selectedPlayerIds.length < 2) {
    return {
      filterOptions,
      selectedFilters: filters,
      selectedPlayerIds,
      playersComparison: [],
      radarChartData: null,
      metricTable: [],
      warning: null,
    };
  }

  const analyticsBatch = await getPlayersAnalyticsBatch(selectedPlayerIds, filterOptions.club.id, filters.seasonId);
  const playersComparison = analyticsBatch.map((player) => ({
    ...player,
    areaEntries: Object.values(player.groupedMetricBreakdown),
  }));

  return {
    filterOptions,
    selectedFilters: filters,
    selectedPlayerIds,
    playersComparison,
    radarChartData: buildRadarChartData(playersComparison),
    metricTable: buildMetricComparisonTable(playersComparison),
    warning: detectLowSampleWarning(playersComparison),
  };
}

module.exports = {
  getComparisonFilters,
  buildComparison,
};
