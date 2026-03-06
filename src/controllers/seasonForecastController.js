const {
  getSeasonForecastOverview,
  getPlayerSeasonForecast,
  getTeamSeasonForecast,
} = require('../services/seasonForecastService');

async function renderIndex(req, res) {
  try {
    const selectedFilters = {
      seasonId: req.query.season_id || null,
      section: req.query.section || null,
      category: req.query.category || null,
      teamId: req.query.team_id || null,
    };
    const forecast = await getSeasonForecastOverview(req.session.user, selectedFilters);
    return res.render('season-forecast/index', {
      pageTitle: 'Prevision 26/27',
      activeRoute: '/season-forecast',
      forecast,
      selectedFilters,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading season forecast index', err);
    req.flash('error', 'Ha ocurrido un error al cargar la previsión de temporada.');
    return res.redirect('/dashboard');
  }
}

async function renderPlayer(req, res) {
  try {
    const seasonId = req.query.season_id || null;
    const result = await getPlayerSeasonForecast(req.session.user, req.params.id, seasonId);
    return res.render('season-forecast/player', {
      pageTitle: 'Prevision jugador',
      activeRoute: '/season-forecast',
      result,
      selectedSeasonId: seasonId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading player forecast', err);
    req.flash('error', 'Ha ocurrido un error al cargar la previsión del jugador.');
    return res.redirect('/season-forecast');
  }
}

async function renderTeam(req, res) {
  try {
    const seasonId = req.query.season_id || null;
    const result = await getTeamSeasonForecast(req.session.user, req.params.id, seasonId);
    return res.render('season-forecast/team', {
      pageTitle: 'Prevision equipo',
      activeRoute: '/season-forecast',
      result,
      selectedSeasonId: seasonId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading team forecast', err);
    req.flash('error', 'Ha ocurrido un error al cargar la previsión del equipo.');
    return res.redirect('/season-forecast');
  }
}

module.exports = {
  renderIndex,
  renderPlayer,
  renderTeam,
};
