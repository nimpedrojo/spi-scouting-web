const {
  comparePlayerBetweenSeasons,
  compareTeamBetweenSeasons,
  getSeasonComparisonFilters,
} = require('../services/seasonComparisonService');

async function renderIndex(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const selectedFilters = {
      sourceSeasonId: req.query.source_season_id || null,
      targetSeasonId: req.query.target_season_id || (activeSeason ? activeSeason.id : null),
      section: req.query.section || null,
      category: req.query.category || null,
      teamId: req.query.team_id || null,
      playerId: req.query.player_id || null,
    };
    const filterOptions = await getSeasonComparisonFilters(req.session.user, selectedFilters);
    return res.render('season-comparison/index', {
      pageTitle: 'Comparativa 26/27',
      activeRoute: '/season-comparison',
      filterOptions,
      selectedFilters,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading season comparison index', err);
    req.flash('error', 'Ha ocurrido un error al cargar la comparativa por temporada.');
    return res.redirect('/dashboard');
  }
}

async function renderPlayer(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const selectedFilters = {
      sourceSeasonId: req.query.source_season_id || null,
      targetSeasonId: req.query.target_season_id || (activeSeason ? activeSeason.id : null),
      section: req.query.section || null,
      category: req.query.category || null,
      teamId: req.query.team_id || null,
      playerId: req.params.id,
    };
    const [filterOptions, comparison] = await Promise.all([
      getSeasonComparisonFilters(req.session.user, selectedFilters),
      comparePlayerBetweenSeasons(
        req.session.user,
        req.params.id,
        selectedFilters.sourceSeasonId,
        selectedFilters.targetSeasonId,
      ),
    ]);

    return res.render('season-comparison/player', {
      pageTitle: 'Comparativa jugador',
      activeRoute: '/season-comparison',
      filterOptions,
      selectedFilters,
      comparison,
      chartJson: comparison ? JSON.stringify(comparison.radarChartData) : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading player season comparison', err);
    req.flash('error', 'Ha ocurrido un error al comparar temporadas del jugador.');
    return res.redirect('/season-comparison');
  }
}

async function renderTeam(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const selectedFilters = {
      sourceSeasonId: req.query.source_season_id || null,
      targetSeasonId: req.query.target_season_id || (activeSeason ? activeSeason.id : null),
      section: req.query.section || null,
      category: req.query.category || null,
      teamId: req.params.id,
    };
    const [filterOptions, comparison] = await Promise.all([
      getSeasonComparisonFilters(req.session.user, selectedFilters),
      compareTeamBetweenSeasons(
        req.session.user,
        req.params.id,
        selectedFilters.sourceSeasonId,
        selectedFilters.targetSeasonId,
      ),
    ]);

    return res.render('season-comparison/team', {
      pageTitle: 'Comparativa equipo',
      activeRoute: '/season-comparison',
      filterOptions,
      selectedFilters,
      comparison,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading team season comparison', err);
    req.flash('error', 'Ha ocurrido un error al comparar temporadas del equipo.');
    return res.redirect('/season-comparison');
  }
}

module.exports = {
  renderIndex,
  renderPlayer,
  renderTeam,
};
