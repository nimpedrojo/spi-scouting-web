const {
  buildScoutingTeamsFormData,
  getScoutingTeamsIndexData,
  getScoutingTeamsFormOptions,
  findScoutingTeamReportById,
  createScoutingTeamsReport,
  updateScoutingTeamsReport,
  deleteScoutingTeamReport,
} = require('../services/scoutingTeamsService');
const { getScoutingTeamsPermissions } = require('../services/scoutingTeamsPermissionService');

async function renderIndex(req, res) {
  const club = req.context ? req.context.club : null;
  const scopedTeamId = req.query.team_id ? String(req.query.team_id).trim() : '';
  const filters = {
    search: req.query.q ? String(req.query.q).trim() : '',
    teamId: scopedTeamId || null,
  };

  const data = await getScoutingTeamsIndexData(club.id, filters);
  const modulePermissions = getScoutingTeamsPermissions(req.session.user);

  return res.render('modules/scouting-teams/index', {
    pageTitle: 'Scouting Teams',
    reports: data.reports.map((report) => ({
      ...report,
      permissions: getScoutingTeamsPermissions(req.session.user, report),
    })),
    reportCount: data.reportCount,
    filters,
    canCreateReports: modulePermissions.canCreate,
    canManageAllReports: modulePermissions.canManageAll,
  });
}

async function renderNew(req, res) {
  const club = req.context ? req.context.club : null;
  const teamOptions = await getScoutingTeamsFormOptions(club.id);
  const scopedTeamId = req.query.team_id ? String(req.query.team_id).trim() : '';
  const initialTeamId = teamOptions.some((team) => String(team.id) === scopedTeamId)
    ? scopedTeamId
    : '';

  return res.render('modules/scouting-teams/form', {
    pageTitle: 'Nuevo informe de scouting',
    formAction: '/scouting-teams',
    submitLabel: 'Guardar informe',
    report: null,
    formData: buildScoutingTeamsFormData({
      own_team_id: initialTeamId,
    }),
    teamOptions,
  });
}

async function create(req, res) {
  const club = req.context ? req.context.club : null;

  try {
    const report = await createScoutingTeamsReport(club.id, req.session.user.id, req.body);
    req.flash('success', 'Informe de scouting de equipos creado correctamente.');
    return res.redirect(`/scouting-teams/${report.id}`);
  } catch (err) {
    const teamOptions = await getScoutingTeamsFormOptions(club.id);
    const message = err && err.code === 'INVALID_TEAM_SCOPE'
      ? 'El equipo propio seleccionado no pertenece al club activo.'
      : 'Debes indicar al menos el rival observado.';

    req.flash('error', message);
    return res.status(422).render('modules/scouting-teams/form', {
      pageTitle: 'Nuevo informe de scouting',
      formAction: '/scouting-teams',
      submitLabel: 'Guardar informe',
      report: null,
      formData: buildScoutingTeamsFormData(req.body),
      teamOptions,
    });
  }
}

async function renderShow(req, res) {
  const report = req.scoutingTeamsReport;
  const permissions = req.scoutingTeamsPermissions || getScoutingTeamsPermissions(req.session.user, report);

  return res.render('modules/scouting-teams/show', {
    pageTitle: `Scouting Teams · ${report.opponentName}`,
    report,
    permissions,
  });
}

async function renderEdit(req, res) {
  const club = req.context ? req.context.club : null;
  const report = req.scoutingTeamsReport;
  const teamOptions = await getScoutingTeamsFormOptions(club.id);

  return res.render('modules/scouting-teams/form', {
    pageTitle: `Editar scouting · ${report.opponentName}`,
    formAction: `/scouting-teams/${report.id}/update`,
    submitLabel: 'Actualizar informe',
    report,
    formData: {
      opponent_name: report.opponentName || '',
      opponent_country_name: report.opponentCountryName || '',
      own_team_id: report.ownTeamId || '',
      match_date: report.matchDate ? report.matchDate.toISOString().slice(0, 10) : '',
      competition: report.competition || '',
      system_shape: report.systemShape || '',
      style_in_possession: report.styleInPossession || '',
      style_out_of_possession: report.styleOutOfPossession || '',
      transitions: report.transitions || '',
      set_pieces: report.setPieces || '',
      strengths: report.strengths || '',
      weaknesses: report.weaknesses || '',
      key_players: report.keyPlayers || '',
      general_observations: report.generalObservations || '',
    },
    teamOptions,
  });
}

async function update(req, res) {
  const club = req.context ? req.context.club : null;

  try {
    const report = await updateScoutingTeamsReport(club.id, req.params.id, req.body);

    if (!report) {
      req.flash('error', 'Informe de scouting de equipos no encontrado.');
      return res.redirect('/scouting-teams');
    }

    req.flash('success', 'Informe de scouting de equipos actualizado correctamente.');
    return res.redirect(`/scouting-teams/${report.id}`);
  } catch (err) {
    const existingReport = await findScoutingTeamReportById(club.id, req.params.id);
    const teamOptions = await getScoutingTeamsFormOptions(club.id);
    const message = err && err.code === 'INVALID_TEAM_SCOPE'
      ? 'El equipo propio seleccionado no pertenece al club activo.'
      : 'Debes indicar al menos el rival observado.';

    req.flash('error', message);
    return res.status(422).render('modules/scouting-teams/form', {
      pageTitle: existingReport
        ? `Editar scouting · ${existingReport.opponentName}`
        : 'Editar scouting',
      formAction: `/scouting-teams/${req.params.id}/update`,
      submitLabel: 'Actualizar informe',
      report: existingReport,
      formData: buildScoutingTeamsFormData(req.body),
      teamOptions,
    });
  }
}

async function remove(req, res) {
  const club = req.context ? req.context.club : null;
  const deleted = await deleteScoutingTeamReport(club.id, req.params.id);

  if (!deleted) {
    req.flash('error', 'Informe de scouting de equipos no encontrado.');
    return res.redirect('/scouting-teams');
  }

  req.flash('success', 'Informe de scouting de equipos eliminado correctamente.');
  return res.redirect('/scouting-teams');
}

module.exports = {
  renderIndex,
  renderNew,
  create,
  renderShow,
  renderEdit,
  update,
  remove,
};
