const { requireClubForUser, getActiveSeasonByClub } = require('../services/teamService');
const { getPlayerAnalytics } = require('../services/playerAnalyticsService');
const { getAreaLabel } = require('../services/evaluationAreaHelper');
const { getReportsForPlayerProfile } = require('../models/reportModel');
const { getPlayerById } = require('../models/playerModel');
const { buildPlayerPdfReport } = require('../services/pdfReportService');

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

async function renderProfile(req, res) {
  try {
    const club = await requireClubForUser(req.session.user);
    if (!club) {
      req.flash('error', 'Debes tener un club activo para ver perfiles.');
      return res.redirect('/dashboard');
    }

    const seasonId = req.query.season_id || null;
    const [player, activeSeason] = await Promise.all([
      getPlayerById(req.params.id, club.name),
      getActiveSeasonByClub(club.id),
    ]);

    if (!player) {
      req.flash('error', 'Jugador no encontrado.');
      return res.redirect('/admin/players');
    }

    const analytics = await getPlayerAnalytics(player.id, club.id, seasonId);
    const reports = await getReportsForPlayerProfile({
      clubName: club.name,
      firstName: player.first_name,
      lastName: player.last_name,
    });

    const playerSummary = analytics.summary || {
      ...player,
      team_name: player.relational_team_name || player.team || '',
      section_name: '',
      category_name: '',
      season_name: activeSeason ? activeSeason.name : '',
      dorsal: '',
      positions: '',
    };

    return res.render('players/show', {
      pageTitle: `${player.first_name} ${player.last_name}`,
      player: {
        ...playerSummary,
        full_name: `${player.first_name} ${player.last_name}`.trim(),
        initials: buildInitials(player),
        age: calculateAge(player.birth_date, player.birth_year),
        preferred_foot: player.preferred_foot || player.laterality || '',
        primary_position: playerSummary.positions
          ? String(playerSummary.positions).split(',')[0].trim()
          : '',
      },
      reports,
      analytics: {
        ...analytics,
        areaEntries: Object.values(analytics.groupedMetricBreakdown || {}),
        radarChartJson: JSON.stringify(analytics.radarChartData),
      },
      areaLabelHelper: getAreaLabel,
      activeSeason,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading player profile', err);
    req.flash('error', 'Ha ocurrido un error al cargar el perfil del jugador.');
    return res.redirect('/admin/players');
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
        return res.redirect('/admin/players');
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
        return res.redirect('/admin/players');
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
