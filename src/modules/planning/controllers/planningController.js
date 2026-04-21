const {
  MICRO_PHASES,
  SESSION_TYPES,
  SESSION_STATUS_OPTIONS,
  TASK_TYPES,
  TASK_COMPLEXITY_OPTIONS,
  TASK_STRATEGY_OPTIONS,
  TASK_COORDINATIVE_SKILLS_OPTIONS,
  TASK_TACTICAL_INTENTION_OPTIONS,
  TASK_DYNAMICS_OPTIONS,
  TASK_GAME_SITUATION_OPTIONS,
  TASK_COORDINATION_OPTIONS,
  getPlanningHomeData,
  getSeasonPlanFormData,
  getMicrocycleFormDataForUser,
  getSeasonPlanDetailForUser,
  getSeasonPlanContextForUser,
  getMicrocycleDetailForUser,
  getSessionDetailForUser,
  createSeasonPlanForUser,
  updateSeasonPlanForUser,
  deleteSeasonPlanForUser,
  duplicateSeasonPlanToNextSeasonForUser,
  createMicrocycleForUser,
  updateMicrocycleForUser,
  duplicateMicrocycleForUser,
  deleteMicrocycleForUser,
  createSessionForUser,
  updateSessionForUser,
  deleteSessionForUser,
  createTaskForUser,
  updateTaskForUser,
  deleteTaskForUser,
  createMicrocycleTemplateFromUser,
  deleteMicrocycleTemplateForUser,
  buildSeasonPlanFormValues,
  buildMicrocycleFormValues,
  buildSessionFormValues,
  buildTemplateFormValues,
  buildTaskFormValues,
  parseSeasonPlanPayload,
  parseMicrocyclePayload,
  parseSessionPayload,
  parseTemplatePayload,
  parseTaskPayload,
} = require('../services/planningService');
const { findPlanSessionTaskById } = require('../models/planSessionTaskModel');
const { deletePlanningTaskImage } = require('../services/planningTaskAssetService');
const { resolveSeasonView } = require('../../../services/seasonViewHelper');

function getUploadedTaskImagePath(req) {
  return req && req.file ? `/uploads/planning/${req.file.filename}` : null;
}

function renderTaskForm(res, {
  pageTitle,
  detail,
  task,
  formAction,
  submitLabel,
  formValues,
}) {
  return res.render('modules/planning/task-form', {
    pageTitle,
    detail,
    task,
    formAction,
    submitLabel,
    formValues,
    taskTypeOptions: TASK_TYPES,
    complexityOptions: TASK_COMPLEXITY_OPTIONS,
    strategyOptions: TASK_STRATEGY_OPTIONS,
    coordinativeSkillsOptions: TASK_COORDINATIVE_SKILLS_OPTIONS,
    tacticalIntentionOptions: TASK_TACTICAL_INTENTION_OPTIONS,
    dynamicsOptions: TASK_DYNAMICS_OPTIONS,
    gameSituationOptions: TASK_GAME_SITUATION_OPTIONS,
    coordinationOptions: TASK_COORDINATION_OPTIONS,
  });
}

async function renderPlanningHome(req, res) {
  const club = req.context ? req.context.club : null;
  const activeSeason = req.context ? req.context.activeSeason : null;
  const requestedTeamId = req.query.team_id ? String(req.query.team_id).trim() : null;
  const seasonView = await resolveSeasonView(club.id, activeSeason, req.query.season_id || null);
  const planning = await getPlanningHomeData(
    req.session.user,
    club,
    seasonView.selectedSeason || activeSeason,
    requestedTeamId,
  );

  return res.render('modules/planning/index', {
    pageTitle: 'SPI Planning',
    planning,
    seasonView,
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
    const formData = await getSeasonPlanFormData(
      req.session.user,
      club,
      existingPlan ? existingPlan.team_id : payload.teamId,
    );
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

async function duplicateSeasonPlanToNextSeason(req, res) {
  const club = req.context ? req.context.club : null;
  const result = await duplicateSeasonPlanToNextSeasonForUser(req.session.user, club.id, req.params.id);

  if (result.errors) {
    req.flash('error', result.errors[0]);
    return res.redirect(`/planning/plans/${req.params.id}`);
  }

  req.flash(
    'success',
    `Planificación duplicada a ${result.targetTeam.name} · ${result.targetSeason.name}.`,
  );
  return res.redirect(`/planning/plans/${result.seasonPlan.id}`);
}

async function renderNewMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const seasonPlanId = req.query.plan_id ? String(req.query.plan_id).trim() : null;
  const templateId = req.query.template_id ? String(req.query.template_id).trim() : null;
  const formData = seasonPlanId
    ? await getMicrocycleFormDataForUser(req.session.user, club.id, seasonPlanId, templateId)
    : null;

  if (!formData || !formData.seasonPlan) {
    req.flash('error', 'Selecciona primero una planificación válida.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/microcycle-form', {
    pageTitle: `Nuevo microciclo · ${formData.seasonPlan.team_name}`,
    seasonPlan: formData.seasonPlan,
    microcycle: null,
    formAction: '/planning/microcycles',
    submitLabel: 'Crear microciclo',
    formValues: buildMicrocycleFormValues({}, {
      season_plan_id: formData.seasonPlan.id,
      template_id: formData.selectedTemplate ? formData.selectedTemplate.template.id : '',
      order_index: formData.seasonPlan.microcycle_count + 1,
      name: formData.selectedTemplate ? formData.selectedTemplate.template.name : '',
      phase: formData.selectedTemplate ? formData.selectedTemplate.template.phase : '',
      objective: formData.selectedTemplate ? formData.selectedTemplate.template.objective : '',
      notes: formData.selectedTemplate ? formData.selectedTemplate.template.notes : '',
    }),
    phaseOptions: MICRO_PHASES,
    templates: formData.templates,
    selectedTemplate: formData.selectedTemplate,
  });
}

async function createMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseMicrocyclePayload(req.body);
  const result = await createMicrocycleForUser(req.session.user, club.id, payload);

  if (result.errors) {
    const formData = payload.seasonPlanId
      ? await getMicrocycleFormDataForUser(req.session.user, club.id, payload.seasonPlanId, payload.templateId)
      : null;
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/microcycle-form', {
      pageTitle: formData ? `Nuevo microciclo · ${formData.seasonPlan.team_name}` : 'Nuevo microciclo',
      seasonPlan: formData ? formData.seasonPlan : null,
      microcycle: null,
      formAction: '/planning/microcycles',
      submitLabel: 'Crear microciclo',
      formValues: buildMicrocycleFormValues(req.body),
      phaseOptions: MICRO_PHASES,
      templates: formData ? formData.templates : [],
      selectedTemplate: formData ? formData.selectedTemplate : null,
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
    templates: [],
    selectedTemplate: null,
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
      templates: [],
      selectedTemplate: null,
    });
  }

  req.flash('success', 'Microciclo actualizado correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function duplicateMicrocycle(req, res) {
  const club = req.context ? req.context.club : null;
  const result = await duplicateMicrocycleForUser(req.session.user, club.id, req.params.id);

  if (result.errors) {
    req.flash('error', result.errors[0]);
    return res.redirect('/planning');
  }

  req.flash('success', 'Microciclo duplicado correctamente.');
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
      status: 'planned',
    }),
    sessionTypeOptions: SESSION_TYPES,
    sessionStatusOptions: SESSION_STATUS_OPTIONS,
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
      sessionStatusOptions: SESSION_STATUS_OPTIONS,
    });
  }

  req.flash('success', 'Sesión creada correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function renderEditSession(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await getMicrocycleDetailForUser(req.session.user, club.id, req.query.microcycle_id);
  const session = detail
    ? detail.sessions.find((entry) => String(entry.id) === String(req.params.id)) || null
    : null;

  if (!detail || !session) {
    req.flash('error', 'Sesión no encontrada.');
    return res.redirect(detail ? `/planning/microcycles/${detail.microcycle.id}` : '/planning');
  }

  return res.render('modules/planning/session-form', {
    pageTitle: `Editar sesión · ${session.title}`,
    detail,
    session,
    formAction: `/planning/sessions/${session.id}/update`,
    submitLabel: 'Guardar cambios',
    formValues: buildSessionFormValues(session),
    sessionTypeOptions: SESSION_TYPES,
    sessionStatusOptions: SESSION_STATUS_OPTIONS,
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
      sessionStatusOptions: SESSION_STATUS_OPTIONS,
    });
  }

  req.flash('success', 'Sesión actualizada correctamente.');
  return res.redirect(`/planning/microcycles/${result.microcycle.id}`);
}

async function renderSessionShow(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await getSessionDetailForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Sesión no encontrada.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/session-show', {
    pageTitle: `Sesión · ${detail.session.title}`,
    detail,
  });
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

async function renderNewTask(req, res) {
  const club = req.context ? req.context.club : null;
  const sessionId = req.query.session_id ? String(req.query.session_id).trim() : null;
  const detail = sessionId
    ? await getSessionDetailForUser(req.session.user, club.id, sessionId)
    : null;

  if (!detail) {
    req.flash('error', 'Selecciona primero una sesión válida.');
    return res.redirect('/planning');
  }

  return renderTaskForm(res, {
    pageTitle: `Nueva tarea · ${detail.session.title}`,
    detail,
    task: null,
    formAction: '/planning/tasks',
    submitLabel: 'Crear tarea',
    formValues: buildTaskFormValues({}, {
      session_id: detail.session.id,
      sort_order: detail.tasks.length + 1,
    }),
  });
}

async function createTask(req, res) {
  const club = req.context ? req.context.club : null;
  req.body.explanatory_image_path = getUploadedTaskImagePath(req);
  const payload = parseTaskPayload(req.body);
  const result = await createTaskForUser(req.session.user, club.id, payload);

  if (result.errors) {
    await deletePlanningTaskImage(payload.explanatoryImagePath);
    req.body.explanatory_image_path = '';
    const detail = payload.sessionId
      ? await getSessionDetailForUser(req.session.user, club.id, payload.sessionId)
      : null;
    req.flash('error', result.errors[0]);
    return renderTaskForm(res.status(422), {
      pageTitle: detail ? `Nueva tarea · ${detail.session.title}` : 'Nueva tarea',
      detail,
      task: null,
      formAction: '/planning/tasks',
      submitLabel: 'Crear tarea',
      formValues: buildTaskFormValues(req.body),
    });
  }

  req.flash('success', 'Tarea creada correctamente.');
  return res.redirect(`/planning/sessions/${result.session.id}`);
}

async function renderEditTask(req, res) {
  const club = req.context ? req.context.club : null;
  const sessionId = req.query.session_id ? String(req.query.session_id).trim() : null;
  const detail = sessionId
    ? await getSessionDetailForUser(req.session.user, club.id, sessionId)
    : null;
  const task = detail
    ? detail.tasks.find((entry) => String(entry.id) === String(req.params.id)) || null
    : null;

  if (!detail || !task) {
    req.flash('error', 'Tarea no encontrada.');
    return res.redirect(detail ? `/planning/sessions/${detail.session.id}` : '/planning');
  }

  return renderTaskForm(res, {
    pageTitle: `Editar tarea · ${task.title}`,
    detail,
    task,
    formAction: `/planning/tasks/${task.id}/update`,
    submitLabel: 'Guardar cambios',
    formValues: buildTaskFormValues(task),
  });
}

async function updateTask(req, res) {
  const club = req.context ? req.context.club : null;
  const currentTask = await findPlanSessionTaskById(req.params.id);
  const uploadedImagePath = getUploadedTaskImagePath(req);
  const shouldRemoveImage = String(req.body.remove_image || '') === '1';
  req.body.explanatory_image_path = uploadedImagePath
    || (shouldRemoveImage ? '' : (currentTask ? currentTask.explanatory_image_path : ''));
  const payload = parseTaskPayload(req.body);
  const result = await updateTaskForUser(req.session.user, club.id, req.params.id, payload);

  if (result.errors) {
    await deletePlanningTaskImage(uploadedImagePath);
    req.body.explanatory_image_path = shouldRemoveImage ? '' : (currentTask ? currentTask.explanatory_image_path || '' : '');
    const detail = payload.sessionId
      ? await getSessionDetailForUser(req.session.user, club.id, payload.sessionId)
      : null;
    const task = detail
      ? detail.tasks.find((entry) => String(entry.id) === String(req.params.id)) || null
      : null;
    req.flash('error', result.errors[0]);
    return renderTaskForm(res.status(422), {
      pageTitle: task ? `Editar tarea · ${task.title}` : 'Editar tarea',
      detail,
      task,
      formAction: `/planning/tasks/${req.params.id}/update`,
      submitLabel: 'Guardar cambios',
      formValues: buildTaskFormValues(req.body, task || {}),
    });
  }

  if (currentTask && (shouldRemoveImage || uploadedImagePath) && currentTask.explanatory_image_path !== payload.explanatoryImagePath) {
    await deletePlanningTaskImage(currentTask.explanatory_image_path);
  }

  req.flash('success', 'Tarea actualizada correctamente.');
  return res.redirect(`/planning/sessions/${result.session.id}`);
}

async function removeTask(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await deleteTaskForUser(req.session.user, club.id, req.params.id);

  if (!detail) {
    req.flash('error', 'Tarea no encontrada.');
    return res.redirect('/planning');
  }

  await deletePlanningTaskImage(detail.task.explanatory_image_path);
  req.flash('success', 'Tarea eliminada correctamente.');
  return res.redirect(`/planning/sessions/${detail.session.id}`);
}

async function renderNewTemplate(req, res) {
  const club = req.context ? req.context.club : null;
  const sourceMicrocycleId = req.query.microcycle_id ? String(req.query.microcycle_id).trim() : null;
  const detail = sourceMicrocycleId
    ? await getMicrocycleDetailForUser(req.session.user, club.id, sourceMicrocycleId)
    : null;

  if (!detail) {
    req.flash('error', 'Selecciona primero un microciclo válido para guardar la plantilla.');
    return res.redirect('/planning');
  }

  return res.render('modules/planning/template-form', {
    pageTitle: `Guardar plantilla · ${detail.microcycle.name}`,
    detail,
    formAction: '/planning/templates',
    submitLabel: 'Guardar plantilla',
    formValues: buildTemplateFormValues({}, {
      source_microcycle_id: detail.microcycle.id,
      name: `${detail.microcycle.name} base`,
      phase: detail.microcycle.phase,
      objective: detail.microcycle.objective,
      notes: detail.microcycle.notes,
    }),
  });
}

async function createTemplate(req, res) {
  const club = req.context ? req.context.club : null;
  const payload = parseTemplatePayload(req.body);
  const result = await createMicrocycleTemplateFromUser(req.session.user, club.id, payload);

  if (result.errors) {
    const detail = payload.sourceMicrocycleId
      ? await getMicrocycleDetailForUser(req.session.user, club.id, payload.sourceMicrocycleId)
      : null;
    req.flash('error', result.errors[0]);
    return res.status(422).render('modules/planning/template-form', {
      pageTitle: detail ? `Guardar plantilla · ${detail.microcycle.name}` : 'Guardar plantilla',
      detail,
      formAction: '/planning/templates',
      submitLabel: 'Guardar plantilla',
      formValues: buildTemplateFormValues(req.body),
    });
  }

  req.flash('success', 'Plantilla guardada correctamente.');
  return res.redirect(`/planning/plans/${result.detail.seasonPlan.id}`);
}

async function removeTemplate(req, res) {
  const club = req.context ? req.context.club : null;
  const detail = await deleteMicrocycleTemplateForUser(req.session.user, club.id, req.params.id);
  const planId = req.body && req.body.plan_id ? String(req.body.plan_id).trim() : null;

  if (!detail) {
    req.flash('error', 'Plantilla no encontrada.');
    return res.redirect('/planning');
  }

  req.flash('success', 'Plantilla eliminada correctamente.');
  if (planId) {
    return res.redirect(`/planning/plans/${planId}`);
  }
  return res.redirect(`/planning?team_id=${detail.template.team_id}`);
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
  duplicateMicrocycle,
  removeMicrocycle,
  duplicateSeasonPlanToNextSeason,
  renderNewSession,
  createSession,
  renderEditSession,
  updateSession,
  renderSessionShow,
  removeSession,
  renderNewTask,
  createTask,
  renderEditTask,
  updateTask,
  removeTask,
  renderNewTemplate,
  createTemplate,
  removeTemplate,
};
