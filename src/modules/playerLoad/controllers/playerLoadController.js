const {
  getPlayerLoadHomeData,
  getActivityFormData,
  getActivityDetailForUser,
  createActivityForUser,
  updateActivityForUser,
  deleteActivityForUser,
} = require('../services/playerLoadService');
const {
  buildCompetitionImportPreview,
  buildActivityPayloadFromPreview,
} = require('../services/playerLoadImportService');
const { resolveSeasonView } = require('../../../services/seasonViewHelper');

function getRequestClub(req) {
  return req.context ? req.context.club : null;
}

function getRequestSeason(req) {
  return req.context ? req.context.activeSeason : null;
}

function sendErrors(res, errors, statusCode = 422) {
  return res.status(statusCode).json({ errors });
}

function wantsJson(req) {
  return String(req.get('accept') || '').includes('application/json')
    || String(req.get('content-type') || '').includes('application/json');
}

function buildActivityRedirect(query = {}) {
  const params = new URLSearchParams();
  const teamId = query.team_id || query.teamId;
  const seasonId = query.season_id || query.seasonId;

  if (teamId) {
    params.set('team_id', teamId);
  }
  if (seasonId) {
    params.set('season_id', seasonId);
  }

  const suffix = params.toString();
  return `/player-load/activities/new${suffix ? `?${suffix}` : ''}`;
}

function buildIndexRedirect(query = {}) {
  const params = new URLSearchParams();
  const teamId = query.team_id || query.teamId;
  const seasonId = query.season_id || query.seasonId;

  if (teamId) {
    params.set('team_id', teamId);
  }
  if (seasonId) {
    params.set('season_id', seasonId);
  }

  const suffix = params.toString();
  return `/player-load${suffix ? `?${suffix}` : ''}`;
}

async function renderIndex(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    return sendErrors(res, ['Necesitas un club y una temporada activa para consultar Player Load.'], 403);
  }

  const seasonView = await resolveSeasonView(club.id, activeSeason, req.query.season_id || null);
  const playerLoad = await getPlayerLoadHomeData(
    req.session.user,
    club,
    seasonView.selectedSeason || activeSeason,
    req.query,
  );

  if (wantsJson(req)) {
    return res.json({ playerLoad, seasonView });
  }

  return res.render('modules/player-load/index', {
    pageTitle: 'Player Load',
    playerLoad,
    seasonView,
  });
}

async function renderIndexJson(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    return sendErrors(res, ['Necesitas un club y una temporada activa para consultar Player Load.'], 403);
  }

  const seasonView = await resolveSeasonView(club.id, activeSeason, req.query.season_id || null);
  const playerLoad = await getPlayerLoadHomeData(
    req.session.user,
    club,
    seasonView.selectedSeason || activeSeason,
    req.query,
  );

  return res.json({ playerLoad });
}

async function renderNewActivity(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    if (wantsJson(req)) {
      return sendErrors(res, ['Necesitas un club y una temporada activa para registrar exposicion.'], 403);
    }
    req.flash('error', 'Necesitas un club y una temporada activa para registrar exposicion.');
    return res.redirect('/player-load');
  }

  const seasonView = await resolveSeasonView(club.id, activeSeason, req.query.season_id || null);
  const formData = await getActivityFormData(
    req.session.user,
    club,
    seasonView.selectedSeason || activeSeason,
    req.query,
  );

  if (wantsJson(req)) {
    return res.json({ formData, seasonView });
  }

  return res.render('modules/player-load/activity-form', {
    pageTitle: 'Nueva actividad',
    formData,
    seasonView,
    formAction: '/player-load/activities',
    errors: [],
    formValues: {
      activity_type: req.query.activity_type || 'TRAINING',
      activity_date: req.query.activity_date || new Date().toISOString().slice(0, 10),
      title: '',
      duration_minutes: '',
      status: 'done',
      notes: '',
    },
  });
}

async function renderImportForm(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    req.flash('error', 'Necesitas un club y una temporada activa para importar exposicion.');
    return res.redirect('/player-load');
  }

  const seasonView = await resolveSeasonView(club.id, activeSeason, req.query.season_id || null);
  const formData = await getActivityFormData(
    req.session.user,
    club,
    seasonView.selectedSeason || activeSeason,
    req.query,
  );

  return res.render('modules/player-load/import-form', {
    pageTitle: 'Importar Player Load',
    formData,
    seasonView,
    preview: null,
    errors: [],
    formValues: {
      team_id: formData.selectedTeam ? formData.selectedTeam.id : '',
      season_id: seasonView.selectedSeasonId || (formData.activeSeason ? formData.activeSeason.id : ''),
      activity_date: req.query.activity_date || new Date().toISOString().slice(0, 10),
      title: req.query.title || 'Importacion competitiva',
      notes: '',
    },
  });
}

async function previewImport(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    req.flash('error', 'Necesitas un club y una temporada activa para importar exposicion.');
    return res.redirect('/player-load');
  }

  const seasonView = await resolveSeasonView(club.id, activeSeason, req.body.season_id || null);
  const formData = await getActivityFormData(
    req.session.user,
    club,
    seasonView.selectedSeason || activeSeason,
    { team_id: req.body.team_id },
  );
  const errors = [];

  if (!formData.selectedTeam) {
    errors.push('Selecciona un equipo valido.');
  }
  if (!req.file) {
    errors.push('Selecciona un archivo CSV o Excel.');
  }
  if (!req.body.activity_date) {
    errors.push('La fecha de la actividad es obligatoria.');
  }
  if (!req.body.title || !String(req.body.title).trim()) {
    errors.push('El titulo de la actividad es obligatorio.');
  }

  let preview = null;
  if (!errors.length) {
    preview = buildCompetitionImportPreview({
      file: req.file,
      roster: formData.roster,
    });
    if (!preview.importableRows) {
      errors.push('No hay filas importables en el archivo.');
    }
  }

  const formValues = {
    team_id: req.body.team_id || '',
    season_id: seasonView.selectedSeasonId || req.body.season_id || '',
    activity_date: req.body.activity_date || '',
    title: req.body.title || '',
    notes: req.body.notes || '',
  };

  if (errors.length) {
    req.session.playerLoadImportPreview = null;
    return res.status(422).render('modules/player-load/import-form', {
      pageTitle: 'Importar Player Load',
      formData,
      seasonView,
      preview,
      errors,
      formValues,
    });
  }

  req.session.playerLoadImportPreview = {
    clubId: club.id,
    teamId: formData.selectedTeam.id,
    seasonId: seasonView.selectedSeasonId || req.body.season_id,
    activityDate: req.body.activity_date,
    title: req.body.title,
    notes: req.body.notes || null,
    preview,
  };

  return res.render('modules/player-load/import-form', {
    pageTitle: 'Importar Player Load',
    formData,
    seasonView,
    preview,
    errors: [],
    formValues,
  });
}

async function confirmImport(req, res) {
  const club = getRequestClub(req);
  const storedPreview = req.session.playerLoadImportPreview;

  if (!club || !storedPreview || Number(storedPreview.clubId) !== Number(club.id)) {
    req.flash('error', 'No hay una previsualizacion de importacion pendiente.');
    return res.redirect('/player-load/import');
  }

  const payload = buildActivityPayloadFromPreview(storedPreview.preview, {
    teamId: storedPreview.teamId,
    seasonId: storedPreview.seasonId,
    activityDate: storedPreview.activityDate,
    title: storedPreview.title,
    notes: storedPreview.notes,
  });
  const result = await createActivityForUser(req.session.user, club.id, payload);

  if (result.errors) {
    req.flash('error', result.errors.join(' '));
    return res.redirect(`/player-load/import?team_id=${encodeURIComponent(storedPreview.teamId)}&season_id=${encodeURIComponent(storedPreview.seasonId)}`);
  }

  req.session.playerLoadImportPreview = null;
  req.flash('success', `Importacion completada. ${storedPreview.preview.importableRows} jugadores importados.`);
  return res.redirect(buildIndexRedirect({
    team_id: result.activity.team_id,
    season_id: result.activity.season_id,
  }));
}

async function createActivity(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    if (wantsJson(req)) {
      return sendErrors(res, ['Necesitas un club y una temporada activa para registrar exposicion.'], 403);
    }
    req.flash('error', 'Necesitas un club y una temporada activa para registrar exposicion.');
    return res.redirect('/player-load');
  }

  const result = await createActivityForUser(req.session.user, club.id, {
    ...req.body,
    season_id: req.body.season_id || activeSeason.id,
  });

  if (result.errors) {
    if (wantsJson(req)) {
      return sendErrors(res, result.errors);
    }
    req.flash('error', result.errors.join(' '));
    return res.redirect(buildActivityRedirect(req.body));
  }

  if (wantsJson(req)) {
    return res.status(201).json(result);
  }

  req.flash('success', 'Actividad registrada correctamente.');
  return res.redirect(buildIndexRedirect({
    team_id: result.activity.team_id,
    season_id: result.activity.season_id,
  }));
}

async function renderActivityShow(req, res) {
  const club = getRequestClub(req);

  if (!club) {
    return sendErrors(res, ['Necesitas un club activo para consultar esta actividad.'], 403);
  }

  const detail = await getActivityDetailForUser(req.session.user, club.id, req.params.id);
  if (!detail) {
    return sendErrors(res, ['Actividad no encontrada.'], 404);
  }

  return res.json(detail);
}

async function renderEditActivity(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    return sendErrors(res, ['Necesitas un club y una temporada activa para editar exposicion.'], 403);
  }

  const detail = await getActivityDetailForUser(req.session.user, club.id, req.params.id);
  if (!detail) {
    return sendErrors(res, ['Actividad no encontrada.'], 404);
  }

  const formData = await getActivityFormData(req.session.user, club, activeSeason, {
    teamId: detail.activity.team_id,
  });

  return res.json({ detail, formData });
}

async function updateActivity(req, res) {
  const club = getRequestClub(req);

  if (!club) {
    return sendErrors(res, ['Necesitas un club activo para editar exposicion.'], 403);
  }

  const result = await updateActivityForUser(req.session.user, club.id, req.params.id, req.body);

  if (result.errors) {
    return sendErrors(res, result.errors);
  }

  return res.json(result);
}

async function removeActivity(req, res) {
  const club = getRequestClub(req);

  if (!club) {
    return sendErrors(res, ['Necesitas un club activo para eliminar exposicion.'], 403);
  }

  const activity = await deleteActivityForUser(req.session.user, club.id, req.params.id);
  if (!activity) {
    return sendErrors(res, ['Actividad no encontrada.'], 404);
  }

  return res.json({ deleted: true, activity });
}

module.exports = {
  renderIndex,
  renderIndexJson,
  renderNewActivity,
  renderImportForm,
  previewImport,
  confirmImport,
  createActivity,
  renderActivityShow,
  renderEditActivity,
  updateActivity,
  removeActivity,
};
