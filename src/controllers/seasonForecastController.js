const {
  getSeasonForecastOverview,
  getPlayerSeasonForecast,
  getTeamSeasonForecast,
  assignPlayerToNextSeasonTeam,
} = require('../services/seasonForecastService');

async function renderIndex(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const selectedFilters = {
      seasonId: req.query.season_id || (activeSeason ? activeSeason.id : null),
      targetSeasonId: req.query.target_season_id || null,
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

async function assignPlayer(req, res) {
  const redirectParams = new URLSearchParams();
  if (req.body.sourceSeasonId) {
    redirectParams.set('season_id', req.body.sourceSeasonId);
  }
  if (req.body.targetSeasonId) {
    redirectParams.set('target_season_id', req.body.targetSeasonId);
  }
  if (req.body.section) {
    redirectParams.set('section', req.body.section);
  }
  if (req.body.category) {
    redirectParams.set('category', req.body.category);
  }
  if (req.body.teamId) {
    redirectParams.set('team_id', req.body.teamId);
  }

  const redirectUrl = `/season-forecast${redirectParams.toString() ? `?${redirectParams.toString()}` : ''}`;

  try {
    const result = await assignPlayerToNextSeasonTeam(req.session.user, {
      playerId: req.body.playerId,
      sourceSeasonId: req.body.sourceSeasonId,
      targetSeasonId: req.body.targetSeasonId,
      targetTeamId: req.body.targetTeamId,
    });

    if (result.errors && result.errors.length) {
      req.flash('error', result.errors.join(' '));
      return res.redirect(redirectUrl);
    }

    req.flash('success', 'Jugador colocado en la previsión de la siguiente temporada.');
    return res.redirect(redirectUrl);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error assigning season forecast player', err);
    req.flash('error', 'Ha ocurrido un error al guardar la previsión del jugador.');
    return res.redirect(redirectUrl);
  }
}

async function renderPlayer(req, res) {
  try {
    const seasonId = req.query.season_id || (req.context && req.context.activeSeason
      ? req.context.activeSeason.id
      : null);
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
    const seasonId = req.query.season_id || (req.context && req.context.activeSeason
      ? req.context.activeSeason.id
      : null);
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
  assignPlayer,
  renderPlayer,
  renderTeam,
};
