function renderPlanningHome(req, res) {
  return res.render('modules/planning/index', {
    pageTitle: 'Planning',
  });
}

module.exports = {
  renderPlanningHome,
};
