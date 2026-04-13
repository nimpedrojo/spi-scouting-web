function renderAssessmentHub(req, res) {
  return res.render('assessments/index', {
    pageTitle: 'Valoraciones',
    activeRoute: '/assessments',
    assessmentHub: {
      actions: {
        scouting: {
          listHref: '/reports',
          createHref: '/reports/new',
        },
        evaluations: {
          listHref: '/evaluations',
          createHref: '/evaluations/new',
          compareHref: '/evaluations/compare',
        },
      },
    },
  });
}

module.exports = {
  renderAssessmentHub,
};
