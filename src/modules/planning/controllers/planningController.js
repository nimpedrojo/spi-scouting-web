const {
  MICRO_PHASES,
  SESSION_TYPES,
  getPlanningHomeData,
  getSeasonPlanFormData,
  getSeasonPlanDetailForUser,
  getSeasonPlanContextForUser,
  getMicrocycleDetailForUser,
  createSeasonPlanForUser,
  updateSeasonPlanForUser,
  deleteSeasonPlanForUser,
  createMicrocycleForUser,
  updateMicrocycleForUser,
  deleteMicrocycleForUser,
  createSessionForUser,
  updateSessionForUser,
  deleteSessionForUser,
  buildSeasonPlanFormValues,
  buildMicrocycleFormValues,
  buildSessionFormValues,
  parseSeasonPlanPayload,
  parseMicrocyclePayload,
  parseSessionPayload,
} = require('../services/planningService');

async function renderPlanningHome(req, res) {
  const club = req.context ? req.context.club : null;
  const activeSeason = req.context ? req.context.activeSeason : null;
  const requestedTeamId = req.query.team_id ? String(req.query.team_id).trim() : null;
  const planning = await getPlanningHomeData(req.session.user, club, activeSeason, requestedTeamId);

  return res.render('modules/planning/index', {
    pageTitle: 'SPI Planning',
    planning,
  });
}

async function renderNewSeasonPlan(req, res) {
  const club = req.context ? req.context.club : null;
  const requestedTeamId = req.query.team_id ? String(req.query.team_id).trim() : null;
  const formData = await getSeasonPlanFormData(req.session.user, club, requestedTeamId);

  if (!formData.selectedTeam) {
    req.flash('error', 'Selecciona un equipo válido para crear una planificación.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/plan-form', {
    pageTitle: 'Nueva planificación',
    seasonPlan: null,
    formAction: '/planning/plans',
    submitLabel: 'Crear planificación',
    formValues: buildSeasonPlanFormValues({}, {
      team_id: formData.selectedTeam.id,
      season_label: formData.activeSeason ? formData.activeSeason.name : formData.selectedTeam.season_name || '',
      planning_model: 'structured_microcycle',
    }),
    formData,
  });
}

async function createSeasonPlan(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseSeasonPlanPayload(req.body);
  const result = await createSeasonPlanForUser(req.session.user, club.id, payload);

  if (result.errors) {
    const formData = await getSeasonPlanFormData(req.session.user, club, payload.teamId);
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/plan-form', {
      pageTitle: 'Nueva planificación',
      seasonPlan: null,
      formAction: '/planning/plans',
      submitLabel: 'Crear planificación',
      formValues: buildSeasonPlanFormValues(req.body),
      formData,
    });
  }

  req.flash('success', 'Planificación creada correctamente.');
  return res.redirect(`/planning/plans/${result.seasonPlan.id}`);
}

async function renderSeasonPlanShow(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await getSeasonPlanDetailForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Planificación no encontrada.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/plan-show', {
    pageTitle: `SPI Planning · ${detail.seasonPlan.team_name}`,
    detail,
  });
}

async function renderEditSeasonPlan(req, res) {
  const club = req.context ? req.context.club : null;
  const seasonPlan = await getSeasonPlanContextForUser(req.session.user, club.id, req.params.id);

  if (!seasonPlan) {
    req.flash('error', 'Planificación no encontrada.');
    return res.redirect('/planning');
  }

  const formData = await getSeasonPlanFormData(req.session.user, club, seasonPlan.team_id);
  return res.render('modules/planning/plan-form', {
    pageTitle: `Editar planificación · ${seasonPlan.team_name}`,
    seasonPlan,
    formAction: `/planning/plans/${seasonPlan.id}/update`,
    submitLabel: 'Guardar cambios',
    formValues: buildSeasonPlanFormValues(seasonPlan),
    formData,
  });
}

async function updateSeasonPlan(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseSeasonPlanPayload(req.body);
  const result = await updateSeasonPlanForUser(req.session.user, club.id, req.params.id, payload);

  if (result.errors) {
    const existingPlan = await getSeasonPlanContextForUser(req.session.user, club.id, req.params.id);
    const formData = await getSeasonPlanFormData(req.session.user, club, existingPlan ? existingPlan.team_id : payload.teamId);
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/plan-form', {
      pageTitle: existingPlan ? `Editar planificación · ${existingPlan.team_name}` : 'Editar planificación',
      seasonPlan: existingPlan,
      formAction: `/planning/plans/${req.params.id}/update`,
      submitLabel: 'Guardar cambios',
      formValues: buildSeasonPlanFormValues(req.body, existingPlan || {}),
      formData,
    });
  }

  req.flash('success', 'Planificación actualizada correctamente.');
  return res.redirect(`/planning/plans/${result.seasonPlan.id}`);
}

async function removeSeasonPlan(req, res) {
  const club = req.context ? req.context.club : null;
  const seasonPlan = await deleteSeasonPlanForUser(req.session.user, club.id, req.params.id);

  if (!seasonPlan) {
    req.flash('error', 'Planificación no encontrada.');
    return res.redirect('/planning');
  }

  req.flash('success', 'Planificación eliminada correctamente.');
  return res.redirect(`/planning?team_id=${seasonPlan.team_id}`);
}

async function renderNewMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const seasonPlanId = req.query.plan_id ? String(req.query.plan_id).trim() : null;
  const seasonPlan = seasonPlanId
    ? await getSeasonPlanContextForUser(req.session.user, club.id, seasonPlanId)
    : null;

  if (!seasonPlan) {
    req.flash('error', 'Selecciona primero una planificación válida.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/microcycle-form', {
    pageTitle: `Nuevo microciclo · ${seasonPlan.team_name}`,
    seasonPlan,
    microcycle: null,
    formAction: '/planning/microcycles',
    submitLabel: 'Crear microciclo',
    formValues: buildMicrocycleFormValues({}, {
      season_plan_id: seasonPlan.id,
      order_index: seasonPlan.microcycle_count + 1,
    }),
    phaseOptions: MICRO_PHASES,
  });
}

async function createMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseMicrocyclePayload(req.body);
  const result = await createMicrocycleForUser(req.session.user, club.id, payload);

  if (result.errors) {
    const seasonPlan = payload.seasonPlanId
      ? await getSeasonPlanContextForUser(req.session.user, club.id, payload.seasonPlanId)
      : null;
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/microcycle-form', {
      pageTitle: seasonPlan ? `Nuevo microciclo · ${seasonPlan.team_name}` : 'Nuevo microciclo',
      seasonPlan,
      microcycle: null,
      formAction: '/planning/microcycles',
      submitLabel: 'Crear microciclo',
      formValues: buildMicrocycleFormValues(req.body),
      phaseOptions: MICRO_PHASES,
    });
  }

  req.flash('success', 'Microciclo creado correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function renderMicrocycleShow(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await getMicrocycleDetailForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Microciclo no encontrado.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/microcycle-show', {
    pageTitle: `Microciclo · ${detail.microcycle.name}`,
    detail,
  });
}

async function renderEditMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await getMicrocycleDetailForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Microciclo no encontrado.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/microcycle-form', {
    pageTitle: `Editar microciclo · ${detail.microcycle.name}`,
    seasonPlan: detail.seasonPlan,
    microcycle: detail.microcycle,
    formAction: `/planning/microcycles/${detail.microcycle.id}/update`,
    submitLabel: 'Guardar cambios',
    formValues: buildMicrocycleFormValues(detail.microcycle),
    phaseOptions: MICRO_PHASES,
  });
}

async function updateMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseMicrocyclePayload(req.body);
  const result = await updateMicrocycleForUser(req.session.user, club.id, req.params.id, payload);

  if (result.errors) {
    const detail = await getMicrocycleDetailForUser(req.session.user, club.id, req.params.id);
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/microcycle-form', {
      pageTitle: detail ? `Editar microciclo · ${detail.microcycle.name}` : 'Editar microciclo',
      seasonPlan: detail ? detail.seasonPlan : null,
      microcycle: detail ? detail.microcycle : null,
      formAction: `/planning/microcycles/${req.params.id}/update`,
      submitLabel: 'Guardar cambios',
      formValues: buildMicrocycleFormValues(req.body, detail ? detail.microcycle : {}),
      phaseOptions: MICRO_PHASES,
    });
  }

  req.flash('success', 'Microciclo actualizado correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function removeMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await deleteMicrocycleForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Microciclo no encontrado.');
    return res.redirect('/planning');
  }

  req.flash('success', 'Microciclo eliminado correctamente.');
  return res.redirect(`/planning/plans/${detail.seasonPlan.id}`);
}

async function renderNewSession(req, res) {
  const club = req.context ? req.context.club : null;
  const microcycleId = req.query.microcycle_id ? String(req.query.microcycle_id).trim() : null;
  const detail = microcycleId
    ? await getMicrocycleDetailForUser(req.session.user, club.id, microcycleId)
    : null;

  if (!detail) {
    req.flash('error', 'Selecciona primero un microciclo válido.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/session-form', {
    pageTitle: `Nueva sesión · ${detail.microcycle.name}`,
    detail,
    session: null,
    formAction: '/planning/sessions',
    submitLabel: 'Crear sesión',
    formValues: buildSessionFormValues({}, {
      microcycle_id: detail.microcycle.id,
    }),
    sessionTypeOptions: SESSION_TYPES,
  });
}

async function createSession(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseSessionPayload(req.body);
  const result = await createSessionForUser(req.session.user, club.id, payload);

  if (result.errors) {
    const detail = payload.microcycleId
      ? await getMicrocycleDetailForUser(req.session.user, club.id, payload.microcycleId)
      : null;
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/session-form', {
      pageTitle: detail ? `Nueva sesión · ${detail.microcycle.name}` : 'Nueva sesión',
      detail,
      session: null,
      formAction: '/planning/sessions',
      submitLabel: 'Crear sesión',
      formValues: buildSessionFormValues(req.body),
      sessionTypeOptions: SESSION_TYPES,
    });
  }

  req.flash('success', 'Sesión creada correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function renderEditSession(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await getMicrocycleDetailForUser(req.session.user, club.id, req.query.microcycle_id);
  let session = null;

  if (!detail) {
    req.flash('error', 'Sesión no encontrada.');
    return res.redirect('/planning');
  }

  session = detail.sessions.find((entry) => String(entry.id) === String(req.params.id)) || null;
  if (!session) {
    req.flash('error', 'Sesión no encontrada.');
    return res.redirect(`/planning/microcycles/${detail.microcycle.id}`);
  }

  return res.render('modules/planning/session-form', {
    pageTitle: `Editar sesión · ${session.title}`,
    detail,
    session,
    formAction: `/planning/sessions/${session.id}/update`,
    submitLabel: 'Guardar cambios',
    formValues: buildSessionFormValues(session),
    sessionTypeOptions: SESSION_TYPES,
  });
}

async function updateSession(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseSessionPayload(req.body);
  const result = await updateSessionForUser(req.session.user, club.id, req.params.id, payload);

  if (result.errors) {
    const detail = payload.microcycleId
      ? await getMicrocycleDetailForUser(req.session.user, club.id, payload.microcycleId)
      : null;
    const session = detail
      ? detail.sessions.find((entry) => String(entry.id) === String(req.params.id)) || null
      : null;
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/session-form', {
      pageTitle: session ? `Editar sesión · ${session.title}` : 'Editar sesión',
      detail,
      session,
      formAction: `/planning/sessions/${req.params.id}/update`,
      submitLabel: 'Guardar cambios',
      formValues: buildSessionFormValues(req.body, session || {}),
      sessionTypeOptions: SESSION_TYPES,
    });
  }

  req.flash('success', 'Sesión actualizada correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function removeSession(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await deleteSessionForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Sesión no encontrada.');
    return res.redirect('/planning');
  }

  req.flash('success', 'Sesión eliminada correctamente.');
  return res.redirect(`/planning/microcycles/${detail.microcycle.id}`);
}

module.exports = {
  renderPlanningHome,
  renderNewSeasonPlan,
  createSeasonPlan,
  renderSeasonPlanShow,
  renderEditSeasonPlan,
  updateSeasonPlan,
  removeSeasonPlan,
  renderNewMicrocycle,
  createMicrocycle,
  renderMicrocycleShow,
  renderEditMicrocycle,
  updateMicrocycle,
  removeMicrocycle,
  renderNewSession,
  createSession,
  renderEditSession,
  updateSession,
  removeSession,
};
