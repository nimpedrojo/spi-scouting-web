const {
  getPlayerLoadHomeData,
  getActivityFormData,
  getActivityDetailForUser,
  createActivityForUser,
  updateActivityForUser,
  deleteActivityForUser,
} = require('../services/playerLoadService');
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

  const wantsJson = String(req.get('accept') || '').includes('application/json');
  if (wantsJson) {
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
    return sendErrors(res, ['Necesitas un club y una temporada activa para registrar exposicion.'], 403);
  }

  const formData = await getActivityFormData(req.session.user, club, activeSeason, req.query);
  return res.json({ formData });
}

async function createActivity(req, res) {
  const club = getRequestClub(req);
  const activeSeason = getRequestSeason(req);

  if (!club || !activeSeason) {
    return sendErrors(res, ['Necesitas un club y una temporada activa para registrar exposicion.'], 403);
  }

  const result = await createActivityForUser(req.session.user, club.id, {
    ...req.body,
    season_id: req.body.season_id || activeSeason.id,
  });

  if (result.errors) {
    return sendErrors(res, result.errors);
  }

  return res.status(201).json(result);
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
  createActivity,
  renderActivityShow,
  renderEditActivity,
  updateActivity,
  removeActivity,
};
