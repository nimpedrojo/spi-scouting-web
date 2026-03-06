const db = require('../db');
const { requireClubForUser } = require('./teamService');
const { getSeasonsByClubId } = require('../models/seasonModel');
const { getAllSections } = require('../models/sectionModel');
const { getAllCategories } = require('../models/categoryModel');
const { getTeamsByClubId, findTeamById } = require('../models/teamModel');
const { getPlayersForComparison, getPlayerAnalytics } = require('./playerAnalyticsService');
const { getAreaLabel } = require('./evaluationAreaHelper');

function computeDelta(sourceValue, targetValue) {
  return Number((Number(targetValue || 0) - Number(sourceValue || 0)).toFixed(2));
}

function buildDeltaBadge(delta) {
  if (delta > 0) {
    return { text: `+${delta.toFixed(2)}`, tone: 'success' };
  }
  if (delta < 0) {
    return { text: `${delta.toFixed(2)}`, tone: 'danger' };
  }
  return { text: '0.00', tone: 'secondary' };
}

function buildPlayerRadarComparison(sourceAnalytics, targetAnalytics, sourceSeasonName, targetSeasonName) {
  const labels = targetAnalytics.averageByArea.map((item) => item.label);
  const sourceByKey = new Map(sourceAnalytics.averageByArea.map((item) => [item.key, item.average]));
  const targetByKey = new Map(targetAnalytics.averageByArea.map((item) => [item.key, item.average]));

  return {
    labels,
    datasets: [
      {
        label: sourceSeasonName,
        data: labels.map((_, index) => {
          const key = targetAnalytics.averageByArea[index].key;
          return Number(sourceByKey.get(key) || 0);
        }),
        borderColor: '#0f3d2e',
        backgroundColor: 'rgba(15, 61, 46, 0.16)',
        pointBackgroundColor: '#0f3d2e',
      },
      {
        label: targetSeasonName,
        data: labels.map((_, index) => {
          const key = targetAnalytics.averageByArea[index].key;
          return Number(targetByKey.get(key) || 0);
        }),
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.16)',
        pointBackgroundColor: '#0284c7',
      },
    ],
  };
}

function buildMetricEvolution(sourceAnalytics, targetAnalytics) {
  const sourceAreas = Object.values(sourceAnalytics.groupedMetricBreakdown);
  const targetAreas = Object.values(targetAnalytics.groupedMetricBreakdown);

  return targetAreas.flatMap((targetArea) => {
    const sourceArea = sourceAreas.find((entry) => entry.key === targetArea.key);
    return targetArea.metrics.map((metric) => {
      const sourceMetric = sourceArea
        ? sourceArea.metrics.find((entry) => entry.key === metric.key)
        : null;
      const sourceValue = sourceMetric ? sourceMetric.average : 0;
      const targetValue = metric.average;
      const delta = computeDelta(sourceValue, targetValue);
      return {
        areaKey: targetArea.key,
        areaLabel: targetArea.label,
        metricKey: metric.key,
        metricLabel: metric.label,
        sourceValue,
        targetValue,
        delta,
        badge: buildDeltaBadge(delta),
      };
    });
  });
}

function hasMissingPlayerData(sourceAnalytics, targetAnalytics) {
  return !sourceAnalytics.history.totalEvaluations || !targetAnalytics.history.totalEvaluations;
}

async function comparePlayerBetweenSeasons(user, playerId, sourceSeasonId, targetSeasonId) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const seasons = await getSeasonsByClubId(club.id);
  const sourceSeason = seasons.find((season) => season.id === sourceSeasonId) || null;
  const targetSeason = seasons.find((season) => season.id === targetSeasonId) || null;

  const [sourceAnalytics, targetAnalytics] = await Promise.all([
    getPlayerAnalytics(playerId, club.id, sourceSeasonId),
    getPlayerAnalytics(playerId, club.id, targetSeasonId),
  ]);

  if (!sourceAnalytics.summary && !targetAnalytics.summary) {
    return null;
  }

  return {
    player: targetAnalytics.summary || sourceAnalytics.summary,
    sourceSeason,
    targetSeason,
    sourceAnalytics,
    targetAnalytics,
    radarChartData: buildPlayerRadarComparison(
      sourceAnalytics,
      targetAnalytics,
      sourceSeason ? sourceSeason.name : 'Origen',
      targetSeason ? targetSeason.name : 'Destino',
    ),
    metricEvolution: buildMetricEvolution(sourceAnalytics, targetAnalytics),
    missingData: hasMissingPlayerData(sourceAnalytics, targetAnalytics),
  };
}

async function getTeamSeasonAggregate(teamId, seasonId) {
  const [rows] = await db.query(
    `SELECT
        t.id AS team_id,
        t.name AS team_name,
        cat.name AS category_name,
        sec.name AS section_name,
        COUNT(DISTINCT tp.player_id) AS total_players,
        COUNT(DISTINCT e.player_id) AS evaluated_players,
        ROUND(AVG(e.overall_score), 2) AS average_team_score,
        COUNT(DISTINCT tp.player_id) - COUNT(DISTINCT e.player_id) AS pending_evaluations
      FROM teams t
      INNER JOIN categories cat ON cat.id = t.category_id
      INNER JOIN sections sec ON sec.id = t.section_id
      LEFT JOIN team_players tp ON tp.team_id = t.id
      LEFT JOIN evaluations e
        ON e.team_id = t.id
        AND e.player_id = tp.player_id
        AND e.season_id = ?
      WHERE t.id = ?
      GROUP BY t.id, t.name, cat.name, sec.name`,
    [seasonId, teamId],
  );
  return rows[0] || null;
}

async function getTeamAreaAverages(teamId, seasonId) {
  const [rows] = await db.query(
    `SELECT
        es.area,
        ROUND(AVG(es.score), 2) AS average
      FROM evaluation_scores es
      INNER JOIN evaluations e ON e.id = es.evaluation_id
      WHERE e.team_id = ? AND e.season_id = ?
      GROUP BY es.area
      ORDER BY FIELD(es.area, 'tecnica', 'tactica', 'fisica', 'psicologica', 'personalidad')`,
    [teamId, seasonId],
  );
  return rows.map((row) => ({
    key: row.area,
    label: getAreaLabel(row.area),
    average: Number(row.average || 0),
  }));
}

async function compareTeamBetweenSeasons(user, teamId, sourceSeasonId, targetSeasonId) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }
  const seasons = await getSeasonsByClubId(club.id);
  const sourceSeason = seasons.find((season) => season.id === sourceSeasonId) || null;
  const targetSeason = seasons.find((season) => season.id === targetSeasonId) || null;

  const baseTeam = await findTeamById(teamId);
  if (!baseTeam || baseTeam.club_id !== club.id) {
    return null;
  }

  const [sourceAggregate, targetAggregate, sourceAreas, targetAreas] = await Promise.all([
    getTeamSeasonAggregate(teamId, sourceSeasonId),
    getTeamSeasonAggregate(teamId, targetSeasonId),
    getTeamAreaAverages(teamId, sourceSeasonId),
    getTeamAreaAverages(teamId, targetSeasonId),
  ]);

  const sourceMap = new Map(sourceAreas.map((item) => [item.key, item.average]));
  const areaDeltas = targetAreas.map((area) => {
    const sourceValue = Number(sourceMap.get(area.key) || 0);
    const delta = computeDelta(sourceValue, area.average);
    return {
      key: area.key,
      label: area.label,
      sourceValue,
      targetValue: area.average,
      delta,
      badge: buildDeltaBadge(delta),
    };
  });

  return {
    team: baseTeam,
    sourceSeason,
    targetSeason,
    sourceAggregate,
    targetAggregate,
    areaDeltas,
    missingData: !sourceAggregate || !targetAggregate
      || !sourceAggregate.evaluated_players
      || !targetAggregate.evaluated_players,
  };
}

async function getSeasonComparisonFilters(user, selected = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }
  const [seasons, sections, categories, teams, players] = await Promise.all([
    getSeasonsByClubId(club.id),
    getAllSections(),
    getAllCategories(),
    getTeamsByClubId(club.id),
    getPlayersForComparison(club.id, {
      seasonId: selected.targetSeasonId || selected.sourceSeasonId || null,
      section: selected.section || null,
      category: selected.category || null,
      teamId: selected.teamId || null,
    }),
  ]);

  return {
    club,
    seasons,
    sections,
    categories,
    teams,
    players,
  };
}

module.exports = {
  comparePlayerBetweenSeasons,
  compareTeamBetweenSeasons,
  getSeasonComparisonFilters,
  computeDelta,
};
