const db = require('../db');
const { getAreaLabel } = require('./evaluationAreaHelper');

function buildSeasonFilterClause(seasonId, params, alias = 'e') {
  if (!seasonId) {
    return '';
  }
  params.push(seasonId);
  return ` AND ${alias}.season_id = ?`;
}

function buildRadarChartData(areaAverages) {
  return {
    labels: areaAverages.map((item) => item.label),
    datasets: [
      {
        label: 'Media por area',
        data: areaAverages.map((item) => Number(item.average)),
        borderColor: '#0b3b8c',
        backgroundColor: 'rgba(11, 59, 140, 0.18)',
        pointBackgroundColor: '#0b3b8c',
        pointBorderColor: '#ffffff',
      },
    ],
  };
}

async function getPlayerSummary(playerId, clubId) {
  const [rows] = await db.query(
    `SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.birth_date,
        p.birth_year,
        p.phone,
        p.email,
        p.nationality,
        p.preferred_foot,
        p.avatar_color,
        p.laterality,
        p.current_team_id,
        COALESCE(tp.dorsal, '') AS dorsal,
        COALESCE(tp.positions, '') AS positions,
        COALESCE(t.name, p.team) AS team_name,
        sec.name AS section_name,
        cat.name AS category_name,
        s.name AS season_name
      FROM players p
      LEFT JOIN teams t ON t.id = p.current_team_id
      LEFT JOIN team_players tp ON tp.team_id = p.current_team_id AND tp.player_id = p.id
      LEFT JOIN sections sec ON sec.id = t.section_id
      LEFT JOIN categories cat ON cat.id = t.category_id
      LEFT JOIN seasons s ON s.id = t.season_id
      WHERE p.id = ? AND p.club_id = ?`,
    [playerId, clubId],
  );
  return rows[0] || null;
}

async function getOverallAverage(playerId, seasonId = null) {
  const params = [playerId];
  const seasonClause = buildSeasonFilterClause(seasonId, params);
  const [rows] = await db.query(
    `SELECT COALESCE(AVG(e.overall_score), 0) AS overall_average
     FROM evaluations e
     WHERE e.player_id = ?${seasonClause}`,
    params,
  );
  return Number(rows[0] ? rows[0].overall_average : 0);
}

async function getAverageByArea(playerId, seasonId = null) {
  const params = [playerId];
  const seasonClause = buildSeasonFilterClause(seasonId, params);
  const [rows] = await db.query(
    `SELECT
        es.area,
        ROUND(AVG(es.score), 2) AS average
      FROM evaluation_scores es
      INNER JOIN evaluations e ON e.id = es.evaluation_id
      WHERE e.player_id = ?${seasonClause}
      GROUP BY es.area
      ORDER BY FIELD(es.area, 'tecnica', 'tactica', 'fisica', 'psicologica', 'personalidad')`,
    params,
  );

  return rows.map((row) => ({
    key: row.area,
    label: getAreaLabel(row.area),
    average: Number(row.average),
  }));
}

async function getGroupedMetricBreakdown(playerId, seasonId = null) {
  const params = [playerId];
  const seasonClause = buildSeasonFilterClause(seasonId, params);
  const [rows] = await db.query(
    `SELECT
        es.area,
        es.metric_key,
        es.metric_label,
        ROUND(AVG(es.score), 2) AS average,
        MIN(es.sort_order) AS sort_order
      FROM evaluation_scores es
      INNER JOIN evaluations e ON e.id = es.evaluation_id
      WHERE e.player_id = ?${seasonClause}
      GROUP BY es.area, es.metric_key, es.metric_label
      ORDER BY FIELD(es.area, 'tecnica', 'tactica', 'fisica', 'psicologica', 'personalidad'), sort_order ASC`,
    params,
  );

  return rows.reduce((acc, row) => {
    if (!acc[row.area]) {
      acc[row.area] = {
        key: row.area,
        label: getAreaLabel(row.area),
        metrics: [],
      };
    }
    acc[row.area].metrics.push({
      key: row.metric_key,
      label: row.metric_label,
      average: Number(row.average),
    });
    return acc;
  }, {});
}

async function getEvaluationHistorySummary(playerId, seasonId = null) {
  const params = [playerId];
  const seasonClause = buildSeasonFilterClause(seasonId, params);
  const [rows] = await db.query(
    `SELECT
        COUNT(*) AS total_evaluations,
        MAX(evaluation_date) AS last_evaluation_date
      FROM evaluations e
      WHERE e.player_id = ?${seasonClause}`,
    params,
  );

  return {
    totalEvaluations: rows[0] ? rows[0].total_evaluations : 0,
    lastEvaluationDate: rows[0] ? rows[0].last_evaluation_date : null,
  };
}

async function getPlayerAnalytics(playerId, clubId, seasonId = null) {
  const [summary, overallAverage, averageByArea, groupedMetricBreakdown, history] = await Promise.all([
    getPlayerSummary(playerId, clubId),
    getOverallAverage(playerId, seasonId),
    getAverageByArea(playerId, seasonId),
    getGroupedMetricBreakdown(playerId, seasonId),
    getEvaluationHistorySummary(playerId, seasonId),
  ]);

  return {
    summary,
    overallAverage,
    averageByArea,
    groupedMetricBreakdown,
    radarChartData: buildRadarChartData(averageByArea),
    history,
  };
}

async function getPlayersForComparison(clubId, filters = {}) {
  const params = [clubId];
  let sql = `
    SELECT
      p.id,
      p.first_name,
      p.last_name,
      COALESCE(t.name, p.team) AS team_name,
      t.id AS team_id,
      sec.name AS section_name,
      cat.name AS category_name
    FROM players p
    LEFT JOIN teams t ON t.id = p.current_team_id
    LEFT JOIN sections sec ON sec.id = t.section_id
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE p.club_id = ?
  `;

  if (filters.teamId) {
    sql += ' AND t.id = ?';
    params.push(filters.teamId);
  }
  if (filters.section) {
    sql += ' AND sec.name = ?';
    params.push(filters.section);
  }
  if (filters.category) {
    sql += ' AND cat.name = ?';
    params.push(filters.category);
  }
  if (filters.seasonId) {
    sql += ' AND t.season_id = ?';
    params.push(filters.seasonId);
  }

  sql += ' ORDER BY p.last_name ASC, p.first_name ASC';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function getPlayersAnalyticsBatch(playerIds, clubId, seasonId = null) {
  const analytics = [];
  for (const playerId of playerIds) {
    // eslint-disable-next-line no-await-in-loop
    const playerAnalytics = await getPlayerAnalytics(playerId, clubId, seasonId);
    if (playerAnalytics.summary) {
      analytics.push({
        ...playerAnalytics,
        summary: {
          ...playerAnalytics.summary,
          fullName: `${playerAnalytics.summary.first_name} ${playerAnalytics.summary.last_name}`.trim(),
        },
      });
    }
  }
  return analytics;
}

module.exports = {
  getPlayerSummary,
  getOverallAverage,
  getAverageByArea,
  getGroupedMetricBreakdown,
  buildRadarChartData,
  getEvaluationHistorySummary,
  getPlayerAnalytics,
  getPlayersForComparison,
  getPlayersAnalyticsBatch,
};
