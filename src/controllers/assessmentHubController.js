function renderAssessmentHub(req, res) {
  const isAdminUser = req.session.user
    && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin');

  return res.render('assessments/index', {
    pageTitle: 'Valoraciones',
    activeRoute: '/assessments',
    assessmentHub: {
      isAdminUser,
      actions: {
        scouting: {
          listHref: '/reports',
          createHref: '/reports/new',
        },
        evaluations: {
          listHref: '/evaluations',
          createHref: isAdminUser ? '/evaluations/new' : null,
          compareHref: isAdminUser ? '/evaluations/compare' : null,
        },
      },
    },
  });
}

module.exports = {
  renderAssessmentHub,
};
