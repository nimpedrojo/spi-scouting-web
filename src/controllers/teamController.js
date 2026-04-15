const {
  getTeamsGroupedBySectionAndCategory,
  getTeamWorkspaceData,
  getTeamFormData,
  createTeamForUser,
  requireClubForUser,
  updateTeamForUser,
  deleteTeamForUser,
  validateTeamPayload,
} = require('../services/teamService');
const { findTeamById, getTeamsByClubId } = require('../models/teamModel');
const { logAuditEvent, logPageView } = require('../services/auditLogger');
const logger = require('../services/logger');
const {
  buildImportPreview,
  importSelectedTeams,
} = require('../services/processIqTeamImportService');
const { importPlayersFromProcessIq } = require('../services/processIqPlayerImportService');
const { findUserById } = require('../models/userModel');
const {
  canAccessTeam,
  getActiveTeamScope,
  canManageMultipleTeams,
} = require('../services/userScopeService');
const { MODULE_KEYS } = require('../shared/constants/moduleKeys');

function getRequestedOperationalClubId(req) {
  if (!req || !req.session || !req.session.user || req.session.user.role !== 'superadmin') {
    return null;
  }

  const rawClubId = (req.query && req.query.club_id) || (req.body && req.body.club_id) || null;
  if (!rawClubId) {
    return null;
  }

  const numericClubId = Number(rawClubId);
  return Number.isInteger(numericClubId) ? numericClubId : null;
}

function buildTeamRedirectSuffix(clubId) {
  return clubId ? `?club_id=${encodeURIComponent(clubId)}` : '';
}

function buildTeamCoreActions(team, canManageMultipleTeamsForUser) {
  const actions = [
    {
      title: 'Plantilla',
      description: 'Jugadores, dorsales y posiciones de la plantilla actual.',
      href: `/teams/${team.id}?view=list#team-roster`,
      meta: `${team.players.length} jugadores`,
    },
    {
      title: 'Jugadores',
      description: 'Alta y mantenimiento de jugadores dentro del entorno core del club.',
      href: '/admin/players',
      meta: 'Gestión de perfiles',
    },
  ];

  if (canManageMultipleTeamsForUser) {
    actions.push({
      title: 'Configuración del equipo',
      description: 'Editar identidad, estructura y metadatos operativos del equipo.',
      href: `/teams/${team.id}/edit`,
      meta: 'Gestión de plantilla',
    });
  }

  return actions;
}

function buildTeamModuleEntries(team, activeModuleKeys, productMode) {
  const entries = [];
  const isPmvPlayerTracking = Boolean(productMode && productMode.isPmvPlayerTracking);

  if (activeModuleKeys.includes(MODULE_KEYS.SCOUTING_PLAYERS)) {
    entries.push({
      key: MODULE_KEYS.SCOUTING_PLAYERS,
      title: 'SPI Scouting Players',
      description: 'Acceso a informes de jugador y evaluaciones vinculadas al contexto del equipo.',
      actions: [
        { label: 'Nuevo informe de jugador', href: `/reports/new?team_id=${team.id}`, variant: 'primary' },
        { label: 'Informes del equipo', href: `/reports?team=${encodeURIComponent(team.name)}`, variant: 'outline-secondary' },
        { label: 'Evaluaciones', href: `/evaluations?team_id=${team.id}`, variant: 'outline-secondary' },
      ],
    });
  }

  if (!isPmvPlayerTracking && activeModuleKeys.includes(MODULE_KEYS.PLANNING)) {
    entries.push({
      key: MODULE_KEYS.PLANNING,
      title: 'SPI Planning',
      description: 'El módulo está activo para el club y hoy ofrece acceso al workspace general de planificación.',
      actions: [
        { label: 'Abrir planning', href: `/planning?team_id=${team.id}`, variant: 'primary' },
      ],
      note: 'El acceso se abre ya contextualizado al equipo dentro del MVP operativo del módulo.',
    });
  }

  if (!isPmvPlayerTracking && activeModuleKeys.includes(MODULE_KEYS.SCOUTING_TEAMS)) {
    entries.push({
      key: MODULE_KEYS.SCOUTING_TEAMS,
      title: 'SPI Scouting Teams',
      description: 'Scouting rival vinculado al equipo propio y acceso al histórico del módulo.',
      actions: [
        { label: 'Nuevo informe rival', href: `/scouting-teams/new?team_id=${team.id}`, variant: 'primary' },
        { label: 'Rivales del equipo', href: `/scouting-teams?team_id=${team.id}`, variant: 'outline-secondary' },
        { label: 'Histórico del módulo', href: '/scouting-teams', variant: 'outline-secondary' },
      ],
    });
  }

  return entries;
}

function summarizeProcessIqError(err) {
  if (!err) {
    return null;
  }

  if (err.bodyText) {
    return String(err.bodyText).slice(0, 300);
  }

  if (err.payload) {
    try {
      return JSON.stringify(err.payload).slice(0, 300);
    } catch (jsonError) {
      return String(err.payload).slice(0, 300);
    }
  }

  return err.message || null;
}

async function runProcessIqPlayerImport(team, user, req) {
  const result = await importPlayersFromProcessIq(team, {
    username: user.processiq_username,
    password: user.processiq_password,
  });

  logAuditEvent(req, 'import_players', 'team', {
    source: 'processiq',
    teamId: team.id,
    rosterCount: result.rosterCount,
    createdCount: result.created,
    updatedCount: result.updated,
    errorCount: result.errors.length,
  });

  return result;
}

async function renderIndex(req, res) {
  try {
    const requestedClubId = getRequestedOperationalClubId(req);
    const club = (req.context && req.context.club)
      || await requireClubForUser(req.session.user, { clubId: requestedClubId });
    if (!club) {
      req.flash('error', 'Configura primero un club por defecto para usar Plantillas.');
      return res.redirect('/dashboard');
    }

    const activeSection = req.query.section || 'Masculina';
    const activeCategory = req.query.category || '';
    const activeSeason = req.context ? req.context.activeSeason : null;
    let groupedTeams = await getTeamsGroupedBySectionAndCategory(club.id, {
      section: activeSection,
      category: activeCategory || null,
    });
    const activeTeamScope = await getActiveTeamScope(req.session.user);

    if (activeTeamScope) {
      groupedTeams = Object.keys(groupedTeams || {}).reduce((acc, sectionName) => {
        const categories = groupedTeams[sectionName] || {};
        const filteredCategories = Object.keys(categories).reduce((categoryAcc, categoryName) => {
          const visibleTeams = (categories[categoryName] || [])
            .filter((team) => String(team.id) === String(activeTeamScope.id));
          if (visibleTeams.length) {
            categoryAcc[categoryName] = visibleTeams;
          }
          return categoryAcc;
        }, {});

        if (Object.keys(filteredCategories).length) {
          acc[sectionName] = filteredCategories;
        }
        return acc;
      }, {});
    }
    logPageView(req, 'teams_index', {
      section: activeSection,
      category: activeCategory || null,
      teamGroupCount: Object.keys(groupedTeams || {}).length,
    });

    return res.render('teams/index', {
      pageTitle: 'Plantillas',
      clubName: club.name,
      selectedClubId: club.id,
      activeSeason,
      activeSection,
      activeCategory,
      groupedTeams,
      canManageMultipleTeams: canManageMultipleTeams(req.session.user),
      availableSections: ['Masculina', 'Femenina'],
      availableCategories: [
        'Juvenil',
        'Cadete',
        'Infantil',
        'Alevín',
        'Benjamín',
        'Prebenjamín',
        'Debutantes',
      ],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading teams index', err);
    req.flash('error', 'Ha ocurrido un error al cargar las plantillas.');
    return res.redirect('/dashboard');
  }
}

async function renderShow(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    const activeModuleKeys = req.context ? req.context.activeModuleKeys || [] : [];
    const productMode = req.context ? req.context.productMode || null : null;
    const team = await getTeamWorkspaceData(req.params.id, { activeModuleKeys });
    const viewMode = req.query.view === 'cards' ? 'cards' : 'list';
    const canAccessRequestedTeam = await canAccessTeam(req.session.user, req.params.id);
    const isSuperAdmin = req.session.user && req.session.user.role === 'superadmin';
    const hasClubAccess = isSuperAdmin ? Boolean(team) : Boolean(club && team && team.club_id === club.id);
    if (!team || !hasClubAccess || !canAccessRequestedTeam) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    logPageView(req, 'team_detail', {
      teamId: team.id,
      viewMode,
      playerCount: team.players.length,
    });

    return res.render('teams/show', {
      pageTitle: team.name,
      team,
      viewMode,
      productMode,
      selectedClubId: team.club_id,
      canManageMultipleTeams: canManageMultipleTeams(req.session.user),
      coreActions: buildTeamCoreActions(team, canManageMultipleTeams(req.session.user)),
      moduleEntries: buildTeamModuleEntries(team, activeModuleKeys, productMode),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading team detail', err);
    req.flash('error', 'Ha ocurrido un error al cargar el equipo.');
    return res.redirect('/teams');
  }
}

async function renderNew(req, res) {
  try {
    const requestedClubId = getRequestedOperationalClubId(req);
    const formData = await getTeamFormData(req.session.user, { clubId: requestedClubId });
    if (!formData) {
      req.flash('error', 'Configura primero un club por defecto para crear equipos.');
      return res.redirect('/dashboard');
    }

    return res.render('teams/form', {
      pageTitle: 'Nueva plantilla',
      team: null,
      formData,
      formAction: '/teams',
      selectedClubId: formData.club.id,
      submitLabel: 'Crear plantilla',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading new team form', err);
    req.flash('error', 'Ha ocurrido un error al cargar el formulario.');
    return res.redirect('/teams');
  }
}

async function create(req, res) {
  try {
    const requestedClubId = getRequestedOperationalClubId(req);
    const payload = {
      name: req.body.name,
      seasonId: req.body.season_id,
      sectionId: req.body.section_id,
      categoryId: req.body.category_id,
      clubId: requestedClubId,
    };
    const validationError = await validateTeamPayload(req.session.user, payload);
    if (validationError) {
      req.flash('error', validationError);
      return res.redirect(`/teams/new${buildTeamRedirectSuffix(requestedClubId)}`);
    }

    const team = await createTeamForUser(req.session.user, payload);
    logAuditEvent(req, 'create', 'team', {
      teamId: team.id,
      teamName: team.name,
      seasonId: payload.seasonId,
      sectionId: payload.sectionId,
      categoryId: payload.categoryId,
    });
    req.flash('success', 'Plantilla creada correctamente.');
    return res.redirect(`/teams/${team.id}${buildTeamRedirectSuffix(requestedClubId)}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error creating team', err);
    req.flash('error', 'Ha ocurrido un error al crear la plantilla.');
    return res.redirect(`/teams/new${buildTeamRedirectSuffix(getRequestedOperationalClubId(req))}`);
  }
}

async function renderEdit(req, res) {
  try {
    const requestedClubId = getRequestedOperationalClubId(req);
    const [formData, team] = await Promise.all([
      getTeamFormData(req.session.user, { clubId: requestedClubId }),
      findTeamById(req.params.id),
    ]);
    if (!formData || !team || team.club_id !== formData.club.id) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    return res.render('teams/form', {
      pageTitle: `Editar ${team.name}`,
      team,
      formData,
      formAction: `/teams/${team.id}/update`,
      selectedClubId: formData.club.id,
      submitLabel: 'Guardar cambios',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading team edit', err);
    req.flash('error', 'Ha ocurrido un error al cargar la plantilla.');
    return res.redirect('/teams');
  }
}

async function update(req, res) {
  try {
    const requestedClubId = getRequestedOperationalClubId(req);
    const payload = {
      name: req.body.name,
      seasonId: req.body.season_id,
      sectionId: req.body.section_id,
      categoryId: req.body.category_id,
      clubId: requestedClubId,
    };
    const validationError = await validateTeamPayload(req.session.user, payload);
    if (validationError) {
      req.flash('error', validationError);
      return res.redirect(`/teams/${req.params.id}/edit${buildTeamRedirectSuffix(requestedClubId)}`);
    }

    const affected = await updateTeamForUser(req.session.user, req.params.id, payload);
    if (!affected) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    logAuditEvent(req, 'update', 'team', {
      teamId: req.params.id,
      teamName: payload.name,
      seasonId: payload.seasonId,
      sectionId: payload.sectionId,
      categoryId: payload.categoryId,
    });
    req.flash('success', 'Plantilla actualizada correctamente.');
    return res.redirect(`/teams/${req.params.id}${buildTeamRedirectSuffix(requestedClubId)}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error updating team', err);
    req.flash('error', 'Ha ocurrido un error al actualizar la plantilla.');
    return res.redirect(`/teams/${req.params.id}/edit${buildTeamRedirectSuffix(getRequestedOperationalClubId(req))}`);
  }
}

async function remove(req, res) {
  try {
    const requestedClubId = getRequestedOperationalClubId(req);
    const affected = await deleteTeamForUser(req.session.user, req.params.id, { clubId: requestedClubId });
    if (!affected) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }
    logAuditEvent(req, 'delete', 'team', {
      teamId: req.params.id,
    });
    req.flash('success', 'Plantilla eliminada correctamente.');
    return res.redirect(`/teams${buildTeamRedirectSuffix(requestedClubId)}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error deleting team', err);
    req.flash('error', 'Ha ocurrido un error al eliminar la plantilla.');
    return res.redirect('/teams');
  }
}

async function renderProcessIqImport(req, res) {
  return res.render('teams/import-processiq', {
    pageTitle: 'Importar desde ProcessIQ',
    preview: req.session.processIqTeamImportPreview || null,
    processIqStatus: req.session.processIqImportStatus || null,
  });
}

async function previewProcessIqImport(req, res) {
  try {
    const club = await requireClubForUser(req.session.user);
    if (!club) {
      req.flash('error', 'Configura primero un club por defecto para importar plantillas.');
      return res.redirect('/teams');
    }

    const user = await findUserById(req.session.user.id);
    const preview = await buildImportPreview(club, {
      username: user.processiq_username,
      password: user.processiq_password,
    });
    req.session.processIqTeamImportPreview = preview;
    req.session.processIqImportStatus = {
      level: preview.items.length ? 'success' : 'warning',
      title: preview.items.length
        ? 'Respuesta recibida de ProcessIQ'
        : 'ProcessIQ respondió sin equipos',
      detail: preview.items.length
        ? `Se recibieron ${preview.diagnostics ? preview.diagnostics.receivedCount : preview.items.length} equipos para revisar.`
        : 'La llamada fue correcta, pero la API no devolvió equipos en este momento.',
    };
    return res.render('teams/import-processiq', {
      pageTitle: 'Importar desde ProcessIQ',
      preview,
      processIqStatus: req.session.processIqImportStatus,
    });
  } catch (err) {
    logger.error('ProcessIQ preview failed', {
      type: 'processiq',
      action: 'preview_failed',
      userId: req.session.user ? req.session.user.id : null,
      email: req.session.user ? req.session.user.email : null,
      error: logger.formatError(err),
      detail: summarizeProcessIqError(err),
    });

    if (err.message === 'PROCESSIQ_CREDENTIALS_MISSING') {
      req.session.processIqImportStatus = {
        level: 'danger',
        title: 'Faltan credenciales de ProcessIQ',
        detail: 'Configura usuario y contraseña en Mi cuenta.',
      };
      req.flash('error', 'Configura usuario y contraseña de ProcessIQ en Mi cuenta.');
      return res.redirect('/account');
    }

    if (err.message === 'PROCESSIQ_AUTH_FAILED') {
      req.session.processIqImportStatus = {
        level: 'danger',
        title: `Error al obtener token (${err.status})`,
        detail: summarizeProcessIqError(err) || 'Sin detalle devuelto por la API.',
      };
      req.flash(
        'error',
        `No se pudo obtener el token de ProcessIQ (${err.status}). Detalle: ${summarizeProcessIqError(err) || 'sin detalle'}`,
      );
      return res.redirect('/account');
    }

    if (err.message === 'PROCESSIQ_FETCH_FAILED') {
      req.session.processIqImportStatus = {
        level: 'danger',
        title: `Error al cargar equipos (${err.status})`,
        detail: summarizeProcessIqError(err) || 'Sin detalle devuelto por la API.',
      };
      req.flash(
        'error',
        `La API de ProcessIQ devolvió un error al cargar equipos (${err.status}). Detalle: ${summarizeProcessIqError(err) || 'sin detalle'}`,
      );
      return res.redirect('/teams/import/processiq');
    }

    if (err.message === 'PROCESSIQ_TOKEN_INVALID') {
      req.session.processIqImportStatus = {
        level: 'danger',
        title: 'Token inválido o ausente en la respuesta',
        detail: summarizeProcessIqError(err) || 'La API autenticó pero no devolvió un token reconocible.',
      };
      req.flash(
        'error',
        `La autenticación de ProcessIQ no devolvió un token válido. Respuesta: ${summarizeProcessIqError(err) || 'vacía'}`,
      );
      return res.redirect('/account');
    }

    // eslint-disable-next-line no-console
    console.error('Error previewing teams from ProcessIQ', err);
    req.session.processIqImportStatus = {
      level: 'danger',
      title: 'Error inesperado al cargar la previsualización',
      detail: summarizeProcessIqError(err) || 'Sin detalle adicional.',
    };
    req.flash('error', 'Ha ocurrido un error al cargar la previsualización desde ProcessIQ.');
    return res.redirect('/teams');
  }
}

async function confirmProcessIqImport(req, res) {
  try {
    const club = await requireClubForUser(req.session.user);
    const preview = req.session.processIqTeamImportPreview || null;
    if (!club || !preview) {
      req.flash('error', 'Primero debes cargar la previsualización de ProcessIQ.');
      return res.redirect('/teams/import/processiq');
    }

    const result = await importSelectedTeams(club, preview.items, req.body);
    logAuditEvent(req, 'import', 'team', {
      source: 'processiq',
      createdCount: result.created,
      skippedCount: result.skipped,
      errorCount: result.errors.length,
    });
    req.session.processIqTeamImportPreview = null;

    req.flash('success', `Importación completada. ${result.created} equipos creados y ${result.skipped} omitidos.`);
    if (result.errors.length) {
      req.flash('error', result.errors.slice(0, 3).join(' | '));
    }
    return res.redirect('/teams');
  } catch (err) {
    logger.error('ProcessIQ import confirm failed', {
      type: 'processiq',
      action: 'confirm_failed',
      userId: req.session.user ? req.session.user.id : null,
      email: req.session.user ? req.session.user.email : null,
      error: logger.formatError(err),
      detail: summarizeProcessIqError(err),
    });
    // eslint-disable-next-line no-console
    console.error('Error confirming teams import from ProcessIQ', err);
    req.flash('error', 'Ha ocurrido un error al importar las plantillas desde ProcessIQ.');
    return res.redirect('/teams/import/processiq');
  }
}

async function importProcessIqPlayers(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    const team = await findTeamById(req.params.id);
    if (!club || !team || team.club_id !== club.id) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    if (team.source !== 'processiq' || !team.external_id) {
      req.flash('error', 'Solo se pueden cargar jugadores en equipos importados desde ProcessIQ.');
      return res.redirect(`/teams/${req.params.id}`);
    }

    const user = await findUserById(req.session.user.id);
    const result = await runProcessIqPlayerImport(team, user, req);

    if (!result.rosterCount) {
      req.flash('warning', 'ProcessIQ respondió el equipo sin jugadores asociados.');
      return res.redirect(`/teams/${req.params.id}`);
    }

    if (result.errors.length) {
      req.flash('warning', `Carga parcial completada. Altas: ${result.created}, actualizados: ${result.updated}, errores: ${result.errors.length}.`);
      return res.redirect(`/teams/${req.params.id}`);
    }

    req.flash('success', `Jugadores cargados desde ProcessIQ. Altas: ${result.created}, actualizados: ${result.updated}.`);
    return res.redirect(`/teams/${req.params.id}`);
  } catch (err) {
    logger.error('ProcessIQ player import failed', {
      type: 'processiq',
      action: 'player_import_failed',
      userId: req.session.user ? req.session.user.id : null,
      teamId: req.params.id,
      error: logger.formatError(err),
      detail: summarizeProcessIqError(err),
    });
    req.flash('error', `No se pudieron cargar los jugadores desde ProcessIQ. ${summarizeProcessIqError(err) || ''}`.trim());
    return res.redirect(`/teams/${req.params.id}`);
  }
}

async function importProcessIqPlayersBulk(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    if (!club) {
      req.flash('error', 'Configura primero un club por defecto para usar Plantillas.');
      return res.redirect('/dashboard');
    }

    const activeSection = req.body.section || req.query.section || 'Masculina';
    const activeCategory = req.body.category || req.query.category || '';
    const teams = await getTeamsByClubId(club.id);
    const eligibleTeams = teams.filter((team) => (
      team.source === 'processiq'
      && team.external_id
      && (!activeSection || team.section_name === activeSection)
      && (!activeCategory || team.category_name === activeCategory)
    ));

    if (!eligibleTeams.length) {
      req.flash('warning', 'No hay equipos ProcessIQ enlazados en la vista actual.');
      return res.redirect(`/teams?section=${encodeURIComponent(activeSection)}${activeCategory ? `&category=${encodeURIComponent(activeCategory)}` : ''}`);
    }

    const user = await findUserById(req.session.user.id);
    const summary = {
      teams: eligibleTeams.length,
      rosterCount: 0,
      created: 0,
      updated: 0,
      emptyTeams: 0,
      errors: [],
    };

    for (const team of eligibleTeams) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await runProcessIqPlayerImport(team, user, req);
        summary.rosterCount += result.rosterCount;
        summary.created += result.created;
        summary.updated += result.updated;
        if (!result.rosterCount) {
          summary.emptyTeams += 1;
        }
        if (result.errors.length) {
          summary.errors.push(`${team.name}: ${result.errors[0]}`);
        }
      } catch (error) {
        summary.errors.push(`${team.name}: ${summarizeProcessIqError(error) || error.message}`);
      }
    }

    if (summary.errors.length) {
      req.flash('warning', `Carga masiva parcial. Equipos: ${summary.teams}, altas: ${summary.created}, actualizados: ${summary.updated}, errores: ${summary.errors.length}.`);
    } else if (summary.rosterCount === 0) {
      req.flash('warning', 'La carga masiva terminó sin jugadores asociados en los equipos visibles.');
    } else {
      req.flash('success', `Carga masiva completada. Equipos: ${summary.teams}, altas: ${summary.created}, actualizados: ${summary.updated}.`);
    }

    return res.redirect(`/teams?section=${encodeURIComponent(activeSection)}${activeCategory ? `&category=${encodeURIComponent(activeCategory)}` : ''}`);
  } catch (err) {
    logger.error('ProcessIQ bulk player import failed', {
      type: 'processiq',
      action: 'bulk_player_import_failed',
      userId: req.session.user ? req.session.user.id : null,
      error: logger.formatError(err),
      detail: summarizeProcessIqError(err),
    });
    req.flash('error', 'No se pudieron cargar los jugadores de ProcessIQ de forma masiva.');
    return res.redirect('/teams');
  }
}

module.exports = {
  renderIndex,
  renderShow,
  renderNew,
  create,
  renderEdit,
  update,
  remove,
  renderProcessIqImport,
  previewProcessIqImport,
  confirmProcessIqImport,
  importProcessIqPlayers,
  importProcessIqPlayersBulk,
};
