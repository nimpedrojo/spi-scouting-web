const { getDashboardData } = require('../services/dashboardService');

async function renderDashboard(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    if (!club) {
      return res.render('dashboard/index', {
        pageTitle: 'Panel general',
        dashboard: null,
        activeSeason: null,
      });
    }

    const activeSeason = req.context ? req.context.activeSeason : null;
    const dashboard = await getDashboardData(club.id, activeSeason);

    return res.render('dashboard/index', {
      pageTitle: 'Panel general',
      dashboard,
      activeSeason,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading dashboard', err);
    req.flash('error', 'Ha ocurrido un error al cargar el panel general.');
    return res.redirect('/');
  }
}

module.exports = {
  renderDashboard,
};
