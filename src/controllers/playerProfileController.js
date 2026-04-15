const { getPlayerAnalytics } = require('../services/playerAnalyticsService');
const { getAreaLabel } = require('../services/evaluationAreaHelper');
const { getReportsForPlayerProfile } = require('../models/reportModel');
const { getPlayerById } = require('../models/playerModel');
const { buildPlayerPdfReport } = require('../services/pdfReportService');
const { canAccessPlayer, canManageMultipleTeams } = require('../services/userScopeService');
const { MODULE_KEYS } = require('../shared/constants/moduleKeys');
const { getPlayerBenchmark } = require('../services/playerBenchmarkService');

function buildInitials(player) {
  return `${(player.first_name || '').charAt(0)}${(player.last_name || '').charAt(0)}`.toUpperCase();
}

function calculateAge(birthDate, birthYear) {
  if (birthDate) {
    const today = new Date();
    const dob = new Date(birthDate);
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age;
  }
  if (birthYear) {
    return new Date().getFullYear() - Number(birthYear);
  }
  return null;
}

function normalizePositions(positionsValue) {
  const aliasMap = {
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
    DCN: 'DEL',
    DELANTERO: 'DEL',
  };
  const supportedPositions = new Set(['POR', 'CENTRAL', 'LD', 'LI', 'MC', 'ID', 'II', 'MP', 'ED', 'EI', 'DEL']);

  if (!positionsValue) {
    return [];
  }

  return Array.from(new Set(String(positionsValue)
    .split(',')
    .map((position) => position.trim().toUpperCase())
    .map((position) => aliasMap[position] || position)
    .filter((position) => supportedPositions.has(position))));
}

function buildEmptyAnalytics() {
  return {
    summary: null,
    overallAverage: 0,
    averageByArea: [],
    groupedMetricBreakdown: {},
    radarChartData: { labels: [], datasets: [] },
    history: {
      totalEvaluations: 0,
      lastEvaluationDate: null,
    },
  };
}

function buildTrackingSummary(analytics, reports) {
  const totalEvaluations = analytics && analytics.history ? Number(analytics.history.totalEvaluations || 0) : 0;
  const totalReports = Array.isArray(reports) ? reports.length : 0;
  const overallAverage = analytics && totalEvaluations && analytics.overallAverage != null
    ? Number(analytics.overallAverage)
    : null;
  const lastEvaluationDate = analytics && analytics.history ? analytics.history.lastEvaluationDate : null;
  const lastReportDate = totalReports && reports[0] ? reports[0].created_at : null;
  const trend = analytics && analytics.history ? analytics.history.trend || null : null;

  return {
    totalEvaluations,
    totalReports,
    overallAverage,
    lastEvaluationDate,
    lastReportDate,
    trend,
  };
}

async function renderProfile(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    if (!club) {
      req.flash('error', 'Debes tener un club activo para ver perfiles.');
      return res.redirect('/dashboard');
    }

    const seasonId = req.query.season_id || null;
    const activeSeason = req.context ? req.context.activeSeason : null;
    const player = await getPlayerById(req.params.id, club.name);

    if (!player || !(await canAccessPlayer(req.session.user, req.params.id))) {
      req.flash('error', 'Jugador no encontrado.');
      return res.redirect('/teams');
    }

    const scoutingPlayersEnabled = Boolean(
      req.context
      && Array.isArray(req.context.activeModuleKeys)
      && req.context.activeModuleKeys.includes(MODULE_KEYS.SCOUTING_PLAYERS),
    );

    const analytics = scoutingPlayersEnabled
      ? await getPlayerAnalytics(player.id, club.id, seasonId)
      : buildEmptyAnalytics();
    const reports = scoutingPlayersEnabled
      ? await getReportsForPlayerProfile({
        clubName: club.name,
        firstName: player.first_name,
        lastName: player.last_name,
      })
      : [];

    const playerSummary = {
      ...analytics.summary,
      ...player,
      team_name: (analytics.summary && analytics.summary.team_name) || player.relational_team_name || player.team || '',
      section_name: (analytics.summary && analytics.summary.section_name) || '',
      category_name: (analytics.summary && analytics.summary.category_name) || '',
      season_name: (analytics.summary && analytics.summary.season_name) || (activeSeason ? activeSeason.name : ''),
      dorsal: player.dorsal || (analytics.summary && analytics.summary.dorsal) || '',
      positions: player.positions || (analytics.summary && analytics.summary.positions) || '',
    };

    const positionsList = normalizePositions(playerSummary.positions);
    const teamProfileHref = player.current_team_id ? `/teams/${player.current_team_id}` : null;
    const benchmarkSeasonId = activeSeason ? activeSeason.id : null;
    const playerBenchmark = scoutingPlayersEnabled && player.current_team_id && benchmarkSeasonId
      ? await getPlayerBenchmark(player.id, player.current_team_id, club.id, benchmarkSeasonId)
      : null;

    return res.render('players/show', {
      pageTitle: `${player.first_name} ${player.last_name}`,
      player: {
        ...playerSummary,
        full_name: `${player.first_name} ${player.last_name}`.trim(),
        initials: buildInitials(player),
        age: calculateAge(player.birth_date, player.birth_year),
        primary_position: positionsList.length ? positionsList[0] : '',
        secondary_positions: positionsList.slice(1),
        positions_list: positionsList,
      },
      reports,
      analytics: {
        ...analytics,
        areaEntries: Object.values(analytics.groupedMetricBreakdown || {}),
        radarChartJson: JSON.stringify(analytics.radarChartData),
      },
      trackingSummary: buildTrackingSummary(analytics, reports),
      scoutingPlayersEnabled,
      areaLabelHelper: getAreaLabel,
      activeSeason,
      canManageMultipleTeams: canManageMultipleTeams(req.session.user),
      teamProfileHref,
      playerBenchmark,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading player profile', err);
    req.flash('error', 'Ha ocurrido un error al cargar el perfil del jugador.');
    return res.redirect('/teams');
  }
}

module.exports = {
  renderProfile,
  async renderPdf(req, res) {
    try {
      const report = await buildPlayerPdfReport(
        req.session.user,
        req.params.id,
        req.query.season_id || null,
      );

      if (!report) {
        req.flash('error', 'Jugador no encontrado.');
        return res.redirect('/teams');
      }

      return res.render('players/pdf', {
        layout: false,
        pageTitle: `Informe de ${report.player.fullName}`,
        report,
        previewMode: false,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error loading player PDF report', err);
      req.flash('error', 'Ha ocurrido un error al generar el informe del jugador.');
      return res.redirect(`/players/${req.params.id}`);
    }
  },
  async renderPdfPreview(req, res) {
    try {
      const report = await buildPlayerPdfReport(
        req.session.user,
        req.params.id,
        req.query.season_id || null,
      );

      if (!report) {
        req.flash('error', 'Jugador no encontrado.');
        return res.redirect('/teams');
      }

      return res.render('players/pdf', {
        layout: false,
        pageTitle: `Previsualizacion de ${report.player.fullName}`,
        report,
        previewMode: true,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error loading player PDF preview', err);
      req.flash('error', 'Ha ocurrido un error al generar la previsualización.');
      return res.redirect(`/players/${req.params.id}`);
    }
  },
};
