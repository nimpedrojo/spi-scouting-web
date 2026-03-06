const db = require('../db');
const { requireClubForUser, getActiveSeasonByClub } = require('./teamService');
const { getSeasonsByClubId } = require('../models/seasonModel');
const { getAllSections } = require('../models/sectionModel');
const { getAllCategories, DEFAULT_CATEGORIES } = require('../models/categoryModel');
const { getTeamsByClubId, findTeamById } = require('../models/teamModel');
const { getPlayersForComparison, getPlayerAnalytics } = require('./playerAnalyticsService');

const CATEGORY_ORDER = DEFAULT_CATEGORIES.slice().reverse();
const READINESS_LEVELS = {
  HIGH: 'alta',
  MEDIUM: 'media',
  LOW: 'baja',
};

const RECOMMENDATIONS = {
  HOLD: 'mantener nivel',
  OBSERVE: 'seguir observando',
  PROMOTION: 'posible salto',
  SUPPORT: 'necesita refuerzo',
};

const FORECAST_RULES = {
  minTrendSample: 2,
  highReadinessScore: 7.5,
  mediumReadinessScore: 6,
  positiveTrendThreshold: 0.35,
  negativeTrendThreshold: -0.35,
  supportThreshold: 5.5,
  promotionScoreThreshold: 8,
  promotionTrendThreshold: 1,
  promotionReadinessScore: 7.25,
  reportRecencyDays: 180,
};

function normalizeSeasonName(season) {
  return season && season.name ? season.name : '';
}

function buildSeasonFilterClause(seasonId, params, alias = 'e') {
  if (!seasonId) {
    return '';
  }
  params.push(seasonId);
  return ` AND ${alias}.season_id = ?`;
}

function getAgeFromPlayer(player) {
  if (player.birth_date) {
    const today = new Date();
    const birthDate = new Date(player.birth_date);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age -= 1;
    }
    return age;
  }
  if (player.birth_year) {
    return new Date().getFullYear() - Number(player.birth_year);
  }
  return null;
}

function inferNextCategory(currentCategory, age = null) {
  const currentIndex = CATEGORY_ORDER.indexOf(currentCategory);
  if (currentIndex === -1) {
    return {
      currentCategory,
      nextCategory: currentCategory || 'Sin categoría',
      reason: 'No existe una regla específica para la categoría actual.',
    };
  }

  let nextIndex = currentIndex;
  if (age !== null) {
    if (age >= 18) {
      nextIndex = CATEGORY_ORDER.indexOf('Juvenil');
    } else if (age >= 16) {
      nextIndex = Math.max(currentIndex, CATEGORY_ORDER.indexOf('Juvenil'));
    } else if (age >= 14) {
      nextIndex = Math.max(currentIndex, CATEGORY_ORDER.indexOf('Cadete'));
    } else if (age >= 12) {
      nextIndex = Math.max(currentIndex, CATEGORY_ORDER.indexOf('Infantil'));
    } else if (age >= 10) {
      nextIndex = Math.max(currentIndex, CATEGORY_ORDER.indexOf('Alevín'));
    } else if (age >= 8) {
      nextIndex = Math.max(currentIndex, CATEGORY_ORDER.indexOf('Benjamín'));
    } else if (age >= 6) {
      nextIndex = Math.max(currentIndex, CATEGORY_ORDER.indexOf('Prebenjamín'));
    } else {
      nextIndex = CATEGORY_ORDER.indexOf('Debutantes');
    }
  } else if (currentIndex > 0) {
    nextIndex = currentIndex - 1;
  }

  const nextCategory = CATEGORY_ORDER[nextIndex] || currentCategory || 'Sin categoría';
  const changed = nextCategory !== currentCategory;
  return {
    currentCategory,
    nextCategory,
    reason: changed
      ? `La proyección avanza desde ${currentCategory} hacia ${nextCategory} por regla de edad/categoría.`
      : `La categoría prevista se mantiene en ${nextCategory} con la información disponible.`,
  };
}

function calculateTrend(historyRows) {
  if (!historyRows || historyRows.length < FORECAST_RULES.minTrendSample) {
    return {
      value: null,
      direction: 'insuficiente',
      label: 'Sin tendencia suficiente',
      explanation: 'No hay suficientes evaluaciones recientes para calcular una tendencia.',
    };
  }

  const first = Number(historyRows[historyRows.length - 1].overall_score || 0);
  const last = Number(historyRows[0].overall_score || 0);
  const delta = Number((last - first).toFixed(2));

  if (delta >= FORECAST_RULES.positiveTrendThreshold) {
    return {
      value: delta,
      direction: 'positiva',
      label: `+${delta.toFixed(2)}`,
      explanation: 'La evolución reciente es positiva.',
    };
  }
  if (delta <= FORECAST_RULES.negativeTrendThreshold) {
    return {
      value: delta,
      direction: 'negativa',
      label: delta.toFixed(2),
      explanation: 'La evolución reciente es negativa.',
    };
  }
  return {
    value: delta,
    direction: 'estable',
    label: delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2),
    explanation: 'La evolución reciente es estable.',
  };
}

function calculateReadiness(overallAverage, trend, totalEvaluations) {
  if (!totalEvaluations) {
    return {
      level: READINESS_LEVELS.LOW,
      reason: 'No hay evaluaciones suficientes para sostener una previsión competitiva.',
    };
  }

  if (
    overallAverage >= FORECAST_RULES.highReadinessScore
    && (!trend.value || trend.value >= 0)
  ) {
    return {
      level: READINESS_LEVELS.HIGH,
      reason: 'El promedio actual es alto y la tendencia no muestra retroceso.',
    };
  }

  if (
    overallAverage >= FORECAST_RULES.mediumReadinessScore
    && trend.direction !== 'negativa'
  ) {
    return {
      level: READINESS_LEVELS.MEDIUM,
      reason: 'El promedio es competitivo, aunque aún requiere seguimiento.',
    };
  }

  return {
    level: READINESS_LEVELS.LOW,
    reason: 'El rendimiento actual o la tendencia reciente indican margen de mejora.',
  };
}

function calculateRecommendation({ readiness, overallAverage, trend, reportSignals, totalEvaluations }) {
  if (!totalEvaluations) {
    return {
      label: RECOMMENDATIONS.OBSERVE,
      reason: 'No existe suficiente muestra evaluativa para una decisión más fuerte.',
    };
  }

  if (
    (
      (readiness.level === READINESS_LEVELS.HIGH
      && overallAverage >= FORECAST_RULES.promotionScoreThreshold)
      || (
        overallAverage >= FORECAST_RULES.promotionReadinessScore
        && trend.value !== null
        && trend.value >= FORECAST_RULES.promotionTrendThreshold
      )
    )
  ) {
    return {
      label: RECOMMENDATIONS.PROMOTION,
      reason: 'El jugador combina nota alta y estabilidad reciente para valorar un salto.',
    };
  }

  if (
    readiness.level === READINESS_LEVELS.LOW
    || overallAverage <= FORECAST_RULES.supportThreshold
    || trend.direction === 'negativa'
  ) {
    return {
      label: RECOMMENDATIONS.SUPPORT,
      reason: 'La previsión detecta necesidad de refuerzo técnico, físico o de seguimiento.',
    };
  }

  if (reportSignals.recentReports > 0 || readiness.level === READINESS_LEVELS.HIGH) {
    return {
      label: RECOMMENDATIONS.HOLD,
      reason: 'La consistencia de datos actuales sugiere mantener el nivel competitivo.',
    };
  }

  return {
    label: RECOMMENDATIONS.OBSERVE,
    reason: 'La situación es válida, pero todavía conviene ampliar la observación.',
  };
}

async function getRecentEvaluationRows(playerId, seasonId = null) {
  const params = [playerId];
  const seasonClause = buildSeasonFilterClause(seasonId, params);
  const [rows] = await db.query(
    `SELECT id, evaluation_date, overall_score
     FROM evaluations e
     WHERE e.player_id = ?${seasonClause}
     ORDER BY e.evaluation_date DESC, e.created_at DESC
     LIMIT 3`,
    params,
  );
  return rows;
}

async function getPlayerReportSignals(clubName, player, seasonDate = new Date()) {
  const [rows] = await db.query(
    `SELECT
        COUNT(*) AS total_reports,
        SUM(CASE WHEN created_at >= DATE_SUB(?, INTERVAL ? DAY) THEN 1 ELSE 0 END) AS recent_reports,
        MAX(created_at) AS last_report_date
      FROM reports
      WHERE club = ? AND player_name = ? AND player_surname = ?`,
    [
      seasonDate,
      FORECAST_RULES.reportRecencyDays,
      clubName,
      player.first_name,
      player.last_name,
    ],
  );

  return {
    totalReports: Number(rows[0] ? rows[0].total_reports : 0),
    recentReports: Number(rows[0] ? rows[0].recent_reports : 0),
    lastReportDate: rows[0] ? rows[0].last_report_date : null,
  };
}

async function getForecastPlayerPool(clubId, filters = {}) {
  return getPlayersForComparison(clubId, {
    seasonId: filters.seasonId || null,
    section: filters.section || null,
    category: filters.category || null,
    teamId: filters.teamId || null,
  });
}

async function buildPlayerForecast(club, playerId, seasonId = null) {
  const analytics = await getPlayerAnalytics(playerId, club.id, seasonId);
  if (!analytics.summary) {
    return null;
  }

  const [historyRows, reportSignals] = await Promise.all([
    getRecentEvaluationRows(playerId, seasonId),
    getPlayerReportSignals(club.name, analytics.summary),
  ]);

  const trend = calculateTrend(historyRows);
  const age = getAgeFromPlayer(analytics.summary);
  const categoryProjection = inferNextCategory(analytics.summary.category_name, age);
  const readiness = calculateReadiness(
    analytics.overallAverage,
    trend,
    analytics.history.totalEvaluations,
  );
  const recommendation = calculateRecommendation({
    readiness,
    overallAverage: analytics.overallAverage,
    trend,
    reportSignals,
    totalEvaluations: analytics.history.totalEvaluations,
  });

  const explanation = [
    categoryProjection.reason,
    readiness.reason,
    recommendation.reason,
  ];

  if (trend.explanation) {
    explanation.push(trend.explanation);
  }
  if (reportSignals.recentReports > 0) {
    explanation.push(`Existen ${reportSignals.recentReports} informes recientes que refuerzan el contexto.`);
  }

  return {
    player: {
      ...analytics.summary,
      fullName: `${analytics.summary.first_name} ${analytics.summary.last_name}`.trim(),
      age,
    },
    currentTeam: analytics.summary.team_name || 'Sin equipo',
    currentCategory: analytics.summary.category_name || 'Sin categoría',
    projectedNextCategory: categoryProjection.nextCategory,
    readinessLevel: readiness.level,
    latestOverallAverage: Number(analytics.overallAverage || 0),
    recentTrend: trend,
    recommendation: recommendation.label,
    explanation,
    totalEvaluations: analytics.history.totalEvaluations,
    lastEvaluationDate: analytics.history.lastEvaluationDate,
    reportSignals,
    averageByArea: analytics.averageByArea,
    hasInsufficientData: !analytics.history.totalEvaluations || trend.direction === 'insuficiente',
  };
}

async function getForecastFilters(user, selected = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [activeSeason, seasons, sections, categories, teams, players] = await Promise.all([
    getActiveSeasonByClub(club.id),
    getSeasonsByClubId(club.id),
    getAllSections(),
    getAllCategories(),
    getTeamsByClubId(club.id),
    getForecastPlayerPool(club.id, selected),
  ]);

  return {
    club,
    activeSeason,
    seasons,
    sections,
    categories,
    teams,
    players,
  };
}

async function getSeasonForecastOverview(user, selected = {}) {
  const filterOptions = await getForecastFilters(user, selected);
  if (!filterOptions) {
    return null;
  }

  const players = await getForecastPlayerPool(filterOptions.club.id, selected);
  const resolvedSeasonId = selected.seasonId || (filterOptions.activeSeason ? filterOptions.activeSeason.id : null);
  const forecastRows = [];
  for (const player of players) {
    // eslint-disable-next-line no-await-in-loop
    const forecast = await buildPlayerForecast(
      filterOptions.club,
      player.id,
      resolvedSeasonId,
    );
    if (forecast) {
      forecastRows.push(forecast);
    }
  }

  return {
    filterOptions,
    selectedFilters: selected,
    rows: forecastRows,
    resolvedSeasonId,
  };
}

async function getPlayerSeasonForecast(user, playerId, seasonId = null) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [filterOptions, forecast] = await Promise.all([
    getForecastFilters(user, { seasonId }),
    buildPlayerForecast(club, playerId, seasonId),
  ]);

  return {
    filterOptions,
    forecast,
    seasonId,
  };
}

async function getTeamSeasonForecastAggregate(teamId, seasonId) {
  const [rows] = await db.query(
    `SELECT
        t.id,
        t.name,
        cat.name AS category_name,
        sec.name AS section_name,
        s.name AS season_name,
        COUNT(DISTINCT tp.player_id) AS total_players
      FROM teams t
      INNER JOIN categories cat ON cat.id = t.category_id
      INNER JOIN sections sec ON sec.id = t.section_id
      INNER JOIN seasons s ON s.id = t.season_id
      LEFT JOIN team_players tp ON tp.team_id = t.id
      WHERE t.id = ? AND t.season_id = ?
      GROUP BY t.id, t.name, cat.name, sec.name, s.name`,
    [teamId, seasonId],
  );
  return rows[0] || null;
}

async function getTeamSeasonForecast(user, teamId, seasonId = null) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [activeSeason, team] = await Promise.all([
    getActiveSeasonByClub(club.id),
    findTeamById(teamId),
  ]);
  const selectedSeasonId = seasonId || (activeSeason ? activeSeason.id : null);

  if (!team || team.club_id !== club.id) {
    return null;
  }

  const [filterOptions, aggregateRows] = await Promise.all([
    getForecastFilters(user, { seasonId: selectedSeasonId, teamId }),
    getTeamSeasonForecastAggregate(teamId, selectedSeasonId),
  ]);

  const players = await getForecastPlayerPool(club.id, { seasonId: selectedSeasonId, teamId });
  const forecastRows = [];
  for (const player of players) {
    // eslint-disable-next-line no-await-in-loop
    const forecast = await buildPlayerForecast(club, player.id, selectedSeasonId);
    if (forecast) {
      forecastRows.push(forecast);
    }
  }

  const summary = forecastRows.reduce((acc, forecast) => {
    acc.totalPlayers += 1;
    if (forecast.projectedNextCategory !== forecast.currentCategory) {
      acc.projectedPromotions += 1;
    } else {
      acc.projectedContinuing += 1;
    }
    if (forecast.readinessLevel === READINESS_LEVELS.MEDIUM) {
      acc.pendingReview += 1;
    }
    if (forecast.hasInsufficientData) {
      acc.insufficientData += 1;
      acc.needsMoreData.push(forecast);
    }
    return acc;
  }, {
    totalPlayers: 0,
    projectedContinuing: 0,
    projectedPromotions: 0,
    pendingReview: 0,
    insufficientData: 0,
    needsMoreData: [],
  });

  return {
    filterOptions,
    team,
    aggregate: aggregateRows,
    summary,
    forecasts: forecastRows,
    seasonLabel: normalizeSeasonName(
      filterOptions.seasons.find((season) => season.id === selectedSeasonId) || filterOptions.activeSeason,
    ),
    seasonId: selectedSeasonId,
  };
}

module.exports = {
  FORECAST_RULES,
  inferNextCategory,
  calculateTrend,
  getForecastFilters,
  getSeasonForecastOverview,
  getPlayerSeasonForecast,
  getTeamSeasonForecast,
};
