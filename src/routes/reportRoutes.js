const express = require('express');
const path = require('path');
const XLSX = require('xlsx');

const {
  createReport,
  getAllReports,
  getAllReportsRaw,
  getReportById,
  updateReport,
  deleteReport,
} = require('../models/reportModel');
const { getClubByName } = require('../models/clubModel');
const { getRecommendationsByClub } = require('../models/clubRecommendationModel');
const { getAllPlayers } = require('../models/playerModel');
const { findTeamById, getTeamsByClubId } = require('../models/teamModel');
const { getSeasonsByClubId } = require('../models/seasonModel');
const { getPlayersByTeamId } = require('../models/teamPlayerModel');
const { buildReportRadarComparison } = require('../services/reportComparisonService');
const { logAuditEvent, logPageView } = require('../services/auditLogger');
const {
  getActiveTeamScope,
  isPrivilegedUser,
} = require('../services/userScopeService');

const router = express.Router();

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Debes iniciar sesión.');
    return res.redirect('/login');
  }
  return next();
}

function ensureAdmin(req, res, next) {
  if (
    !req.session.user
    || (req.session.user.role !== 'admin'
      && req.session.user.role !== 'superadmin')
  ) {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

function normalizeReportPlayerOption(player) {
  return {
    id: player.player_id || player.id,
    first_name: player.first_name,
    last_name: player.last_name,
    birth_year: player.birth_year || '',
    laterality: player.laterality || '',
    relational_team_name: player.team_name || player.relational_team_name || '',
  };
}

function resolveReportFlowContext(players, query = {}, formData = {}) {
  const requestedPlayerId = (query.player_id || formData.player_id || '').toString().trim();
  const requestedTeamId = (query.team_id || formData.team_id || '').toString().trim();
  const selectedPlayer = requestedPlayerId
    ? players.find((player) => String(player.id) === requestedPlayerId)
    : null;

  return {
    requestedPlayerId: selectedPlayer ? String(selectedPlayer.id) : requestedPlayerId || '',
    requestedTeamId,
    selectedPlayer,
    returnToPlayerHref: selectedPlayer ? `/players/${selectedPlayer.id}` : '',
    returnToTeamHref: requestedTeamId ? `/teams/${requestedTeamId}` : '',
  };
}

function populateReportFormFromSelectedPlayer(formData, selectedPlayer, defaultClub, defaultTeamName) {
  if (!selectedPlayer) {
    return formData;
  }

  return {
    ...formData,
    player_id: String(selectedPlayer.id),
    player_name: formData.player_name || selectedPlayer.first_name || '',
    player_surname: formData.player_surname || selectedPlayer.last_name || '',
    team: formData.team || selectedPlayer.relational_team_name || defaultTeamName || '',
    club: formData.club || defaultClub || '',
    year: formData.year || selectedPlayer.birth_year || '',
    laterality: formData.laterality || selectedPlayer.laterality || '',
  };
}

async function loadRecommendationConfig(clubName) {
  let recommendationConfig = {};
  try {
    let rows = await getRecommendationsByClub(clubName);
    if (!rows || !rows.length) {
      rows = await getRecommendationsByClub('DEFAULT');
    }
    recommendationConfig = rows.reduce((acc, r) => {
      const opts = (r.options || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s);
      if (opts.length) {
        acc[r.year] = opts;
      }
      return acc;
    }, {});
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error obteniendo recomendaciones de club:', e);
  }

  return recommendationConfig;
}

async function getReportPlayersForContext(clubName, defaultTeamId = null) {
  if (defaultTeamId) {
    const players = await getPlayersByTeamId(defaultTeamId);
    return players.map(normalizeReportPlayerOption);
  }

  const players = await getAllPlayers(clubName || null);
  return players.map(normalizeReportPlayerOption);
}

function reportBelongsToTeamScope(report, teamScope) {
  if (!teamScope) {
    return true;
  }

  return Boolean(report && String(report.team || '').trim() === String(teamScope.name || '').trim());
}

function isSuperAdminUser(user) {
  return Boolean(user && user.role === 'superadmin');
}

function getReportSessionDefaults(user) {
  const isSuperAdmin = isSuperAdminUser(user);

  return {
    defaultClub: isSuperAdmin ? null : ((user && user.default_club) || 'Stadium Venecia'),
    defaultTeamId: isSuperAdmin ? null : ((user && user.default_team_id) || null),
    defaultTeam: isSuperAdmin ? '' : ((user && user.default_team) || ''),
  };
}

router.get('/new', ensureAuth, async (req, res) => {
  const { defaultClub, defaultTeamId, defaultTeam } = getReportSessionDefaults(req.session.user);
  const requestedTeamId = req.query.team_id ? String(req.query.team_id).trim() : null;
  const activeTeamScope = await getActiveTeamScope(req.session.user);
  const defaultTeamRecord = defaultTeamId ? await findTeamById(defaultTeamId) : null;

  let scopedTeamRecord = null;
  if (requestedTeamId) {
    const candidateTeam = await findTeamById(requestedTeamId);
    const isAllowedTeam = candidateTeam
      && (!defaultClub || candidateTeam.club_name === defaultClub)
      && (!activeTeamScope || String(activeTeamScope.id) === String(candidateTeam.id));

    if (isAllowedTeam) {
      scopedTeamRecord = candidateTeam;
    }
  }

  const resolvedDefaultTeam = scopedTeamRecord
    ? scopedTeamRecord.name
    : (defaultTeamRecord ? defaultTeamRecord.name : defaultTeam);
  const resolvedTeamId = scopedTeamRecord
    ? scopedTeamRecord.id
    : defaultTeamId;

  const clubFilter = defaultClub || null;
  let players = await getReportPlayersForContext(clubFilter, resolvedTeamId);
  if (!players.length && resolvedTeamId) {
    players = await getReportPlayersForContext(clubFilter, null);
  }

  const flowContext = resolveReportFlowContext(players, req.query);
  const recommendationConfig = await loadRecommendationConfig(defaultClub || 'DEFAULT');

  res.render('reports/new', {
    formData: populateReportFormFromSelectedPlayer({
      club: defaultClub,
      team: resolvedDefaultTeam,
      team_id: resolvedTeamId || '',
    }, flowContext.selectedPlayer, defaultClub, resolvedDefaultTeam),
    validationErrors: {},
    players,
    recommendationConfig,
    flowContext,
  });
  logPageView(req, 'report_new_form', {
    playerCount: players.length,
    scopeClub: defaultClub,
    defaultTeamId: resolvedTeamId,
  });
});

router.post('/new', ensureAuth, async (req, res) => {
  const {
    player_name,
    player_surname,
    year,
    club,
    team,
    laterality,
    contact,
    pos1,
    pos2,
    pos3,
    pos4,
    overall_rating,
    comments,
    tech_cobertura_balon,
    tech_conduccion,
    tech_control,
    tech_regate,
    tech_disparo,
    tech_pase,
    tech_remate_cabeza,
    tech_anticipacion,
    tact_transicion_ataque_defensa,
    tact_movimientos_sin_balon,
    tact_ayudas_defensivas,
    tact_ayudas_ofensivas,
    tact_desmarques,
    tact_marcajes,
    phys_sacrificio,
    phys_velocidad_punta,
    phys_velocidad_reaccion,
    phys_fuerza,
    phys_potencia,
    phys_resistencia,
    phys_coordinacion,
    psych_concentracion,
    psych_control_emocional,
    psych_reaccion_errores_arbitrales,
    pers_liderazgo,
    pers_disciplina,
    pers_reaccion_correcciones_companero,
    pers_reaccion_correcciones_tecnico,
    recommendation,
    info_reliability,
  } = req.body;

  try {
    const {
      defaultClub: sessionDefaultClub,
      defaultTeamId: sessionDefaultTeamId,
    } = getReportSessionDefaults(req.session.user);
    const defaultTeamRecord = sessionDefaultTeamId ? await findTeamById(sessionDefaultTeamId) : null;
    const activeTeamScope = await getActiveTeamScope(req.session.user);

    // calcular medias de cada bloque a partir de sus sub-valores
    const toNumber = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    };

    const techValues = [
      tech_cobertura_balon,
      tech_conduccion,
      tech_control,
      tech_regate,
      tech_disparo,
      tech_pase,
      tech_remate_cabeza,
      tech_anticipacion,
    ].map(toNumber).filter((v) => v !== null);
    const tactValues = [
      tact_transicion_ataque_defensa,
      tact_movimientos_sin_balon,
      tact_ayudas_defensivas,
      tact_ayudas_ofensivas,
      tact_desmarques,
      tact_marcajes,
    ].map(toNumber).filter((v) => v !== null);
    const physValues = [
      phys_sacrificio,
      phys_velocidad_punta,
      phys_velocidad_reaccion,
      phys_fuerza,
      phys_potencia,
      phys_resistencia,
      phys_coordinacion,
    ].map(toNumber).filter((v) => v !== null);
    const psychValues = [
      psych_concentracion,
      psych_control_emocional,
      psych_reaccion_errores_arbitrales,
    ].map(toNumber).filter((v) => v !== null);
    const persValues = [
      pers_liderazgo,
      pers_disciplina,
      pers_reaccion_correcciones_companero,
      pers_reaccion_correcciones_tecnico,
    ].map(toNumber).filter((v) => v !== null);

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    const techTotal = avg(techValues);
    const tactTotal = avg(tactValues);
    const physTotal = avg(physValues);
    const psychTotal = avg(psychValues);
    const persTotal = avg(persValues);

    const overallValues = [
      techTotal,
      tactTotal,
      physTotal,
      psychTotal,
      persTotal,
    ].filter((v) => v !== null);
    const overallRating = avg(overallValues);

    if (!player_name || !player_surname) {
      const clubFilter = sessionDefaultClub || null;
      const playersForForm = await getReportPlayersForContext(
        clubFilter,
        sessionDefaultTeamId,
      );
      const flowContext = resolveReportFlowContext(playersForForm, req.body, req.body);
      const recommendationConfig = await loadRecommendationConfig(sessionDefaultClub || clubFilter || 'DEFAULT');
      return res.status(400).render('reports/new', {
        formData: req.body,
        validationErrors: {
          player_name: !player_name,
          player_surname: !player_surname,
        },
        players: playersForForm,
        recommendationConfig,
        flowContext,
      });
    }

    if (activeTeamScope) {
      const allowedPlayers = await getReportPlayersForContext(
        sessionDefaultClub || null,
        activeTeamScope.id,
      );
      const canCreateForPlayer = allowedPlayers.some((player) => (
        String(player.first_name || '').trim().toLowerCase() === String(player_name || '').trim().toLowerCase()
        && String(player.last_name || '').trim().toLowerCase() === String(player_surname || '').trim().toLowerCase()
      ));

      if (!canCreateForPlayer) {
        req.flash('error', 'Solo puedes crear informes para jugadores de tu equipo activo.');
        return res.redirect('/reports/new');
      }
    }

    // Valores por defecto de club/equipo desde la sesión (si no se ha rellenado nada)
    const finalClub = club || sessionDefaultClub || null;
    const finalTeam =
      (activeTeamScope ? activeTeamScope.name : team) || (defaultTeamRecord ? defaultTeamRecord.name : '');

    const reportId = await createReport({
      player_name,
      player_surname,
      year: year || null,
      club: finalClub,
      team: finalTeam,
      laterality,
      contact,
      pos1,
      pos2,
      pos3,
      pos4,
      overall_rating: overallRating,
      comments,
      tech_total: techTotal,
      tact_total: tactTotal,
      phys_total: physTotal,
      psych_total: psychTotal,
      pers_total: persTotal,
      tech_cobertura_balon: tech_cobertura_balon || null,
      tech_conduccion: tech_conduccion || null,
      tech_control: tech_control || null,
      tech_regate: tech_regate || null,
      tech_disparo: tech_disparo || null,
      tech_pase: tech_pase || null,
      tech_remate_cabeza: tech_remate_cabeza || null,
      tech_anticipacion: tech_anticipacion || null,
      tact_transicion_ataque_defensa:
        tact_transicion_ataque_defensa || null,
      tact_movimientos_sin_balon: tact_movimientos_sin_balon || null,
      tact_ayudas_defensivas: tact_ayudas_defensivas || null,
      tact_ayudas_ofensivas: tact_ayudas_ofensivas || null,
      tact_desmarques: tact_desmarques || null,
      tact_marcajes: tact_marcajes || null,
      phys_sacrificio: phys_sacrificio || null,
      phys_velocidad_punta: phys_velocidad_punta || null,
      phys_velocidad_reaccion: phys_velocidad_reaccion || null,
      phys_fuerza: phys_fuerza || null,
      phys_potencia: phys_potencia || null,
      phys_resistencia: phys_resistencia || null,
      phys_coordinacion: phys_coordinacion || null,
      psych_concentracion: psych_concentracion || null,
      psych_control_emocional: psych_control_emocional || null,
      psych_reaccion_errores_arbitrales:
        psych_reaccion_errores_arbitrales || null,
      pers_liderazgo: pers_liderazgo || null,
      pers_disciplina: pers_disciplina || null,
      pers_reaccion_correcciones_companero:
        pers_reaccion_correcciones_companero || null,
      pers_reaccion_correcciones_tecnico:
        pers_reaccion_correcciones_tecnico || null,
      recommendation,
      info_reliability: info_reliability || null,
      created_by: req.session.user.id,
    });
    logAuditEvent(req, 'create', 'report', {
      playerName: `${player_name} ${player_surname}`.trim(),
      team: finalTeam,
      club: finalClub,
      overallRating: overallRating != null ? Number(overallRating.toFixed(2)) : null,
    });
    req.flash('success', 'Informe creado correctamente.');
    return res.redirect(`/reports/${reportId}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear informe:', err);
    req.flash(
      'error',
      `Ha ocurrido un error al guardar el informe: ${err.message}`,
    );
    const { defaultClub, defaultTeamId } = getReportSessionDefaults(req.session.user);
    const clubFilter = defaultClub || null;
    const playersForForm = await getReportPlayersForContext(
      clubFilter,
      defaultTeamId,
    );
    const flowContext = resolveReportFlowContext(playersForForm, req.body, req.body);
    return res.status(500).render('reports/new', {
      formData: req.body,
      validationErrors: {},
      players: playersForForm,
      recommendationConfig: await loadRecommendationConfig(defaultClub || clubFilter || 'DEFAULT'),
      flowContext,
    });
  }
});

// Listado de informes
router.get('/', ensureAuth, async (req, res) => {
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin ? null : req.session.user.default_club || null;
    const activeTeamScope = await getActiveTeamScope(req.session.user);
    const requestedTeamFilter = req.query.team ? String(req.query.team).trim() : null;
    const effectiveTeamFilter = activeTeamScope
      ? activeTeamScope.name
      : requestedTeamFilter;
    let reports = await getAllReports(clubFilter, { team: effectiveTeamFilter });
    if (activeTeamScope) {
      reports = reports.filter((report) => reportBelongsToTeamScope(report, activeTeamScope));
    }
    logPageView(req, 'reports_list', {
      reportCount: reports.length,
      scopeClub: clubFilter,
      team: effectiveTeamFilter,
    });
    res.render('reports/list', {
      reports,
      filters: {
        team: effectiveTeamFilter || '',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al obtener informes:', err);
    req.flash('error', 'Ha ocurrido un error al cargar los informes.');
    res.redirect('/');
  }
});

// Exportar informes a CSV (solo admin)
router.get('/export/csv', ensureAdmin, async (req, res) => {
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin ? null : req.session.user.default_club || null;
    const reports = await getAllReportsRaw(clubFilter);
    if (!reports.length) {
      req.flash('error', 'No hay informes para exportar.');
      return res.redirect('/reports');
    }

    const columns = Object.keys(reports[0]);

    const escapeCell = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [];
    lines.push(columns.join(','));
    reports.forEach((row) => {
      const line = columns.map((col) => escapeCell(row[col])).join(',');
      lines.push(line);
    });

    const csv = `${lines.join('\n')}\n`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="soccer_report.csv"',
    );
    return res.send(csv);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al exportar informes a CSV:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al exportar los informes a CSV.',
    );
    return res.redirect('/reports');
  }
});

// Descargar informe en Excel basado en plantilla
router.get('/:id/excel', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin ? null : req.session.user.default_club || null;
    const report = await getReportById(id, clubFilter);
    if (!report) {
      req.flash('error', 'Informe no encontrado.');
      return res.redirect('/reports');
    }

    const templatePath =
      process.env.REPORT_TEMPLATE_PATH ||
      path.join(__dirname, '..', 'templates', 'report_template.xlsm');

    const workbook = XLSX.readFile(templatePath, {
      cellDates: true,
      cellNF: true,
      cellStyles: true,
      bookVBA: true, // conservar macros y maquetado
    });

    const sheetName = 'INFORME 1';
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      req.flash('error', `No se ha encontrado la hoja "${sheetName}" en la plantilla.`);
      return res.redirect(`/reports/${id}`);
    }

    const setCellValue = (addr, value, type) => {
      const cell = sheet[addr] || {};
      cell.v = value;
      if (type) cell.t = type;
      sheet[addr] = cell;
    };

    // Rellenar celdas según el mapeo proporcionado
    setCellValue('B16', `${report.player_name || ''}`, 's');
    setCellValue('B17', `${report.player_surname || ''}`, 's');
    setCellValue('B18', report.year != null ? String(report.year) : '', 's');

  

    const outBuffer = XLSX.write(workbook, {
      bookType: 'xlsm',
      type: 'buffer',
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Informe_${id}.xlsm"`,
    );
    return res.send(outBuffer);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al generar Excel del informe:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al generar el Excel del informe.',
    );
    return res.redirect(`/reports/${req.params.id}`);
  }
});

// API JSON con todos los datos del informe (para Excel / integraciones)
router.get('/api/:id', ensureAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.session.user
      && req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin
      ? null
      : (req.session.user && req.session.user.default_club) || null;
    const activeTeamScope = await getActiveTeamScope(req.session.user);
    const report = await getReportById(id, clubFilter);
    if (!report || !reportBelongsToTeamScope(report, activeTeamScope)) {
      return res.status(404).json({ error: 'Informe no encontrado' });
    }
    // Devolvemos el objeto completo que viene de la BD (todas las columnas de reports + datos del autor)
    return res.json(report);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error en API de informe:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Detalle de informe
router.get('/:id', ensureAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin ? null : req.session.user.default_club || null;
    const activeTeamScope = await getActiveTeamScope(req.session.user);
    const report = await getReportById(id, clubFilter);
    if (!report || !reportBelongsToTeamScope(report, activeTeamScope)) {
      req.flash('error', 'Informe no encontrado.');
      return res.redirect('/reports');
    }
    const clubPlayers = report.club ? await getAllPlayers(report.club) : [];
    const linkedPlayer = clubPlayers.find((player) => (
      String(player.first_name || '').trim().toLowerCase() === String(report.player_name || '').trim().toLowerCase()
      && String(player.last_name || '').trim().toLowerCase() === String(report.player_surname || '').trim().toLowerCase()
      && (!report.team || !player.relational_team_name || String(player.relational_team_name).trim() === String(report.team).trim())
    )) || null;
    const radarChartData = await buildReportRadarComparison(report);
    const reportClub = report.club ? await getClubByName(report.club) : null;
    const operationalClub = (req.context && req.context.club) || reportClub || null;
    const activeSeason = req.context ? req.context.activeSeason : null;
    const [recommendationSeasons, recommendationTeams] = operationalClub
      ? await Promise.all([
        getSeasonsByClubId(operationalClub.id),
        getTeamsByClubId(operationalClub.id),
      ])
      : [[], []];
    logPageView(req, 'report_detail', {
      reportId: Number(id),
      club: report.club || null,
      team: report.team || null,
      playerName: `${report.player_name} ${report.player_surname}`.trim(),
    });
    return res.render('reports/detail', {
      report,
      reportClub,
      radarChartJson: JSON.stringify(radarChartData),
      linkedPlayer,
      recommendationSeasons,
      recommendationTeams,
      recommendationDefaultSeasonId: activeSeason ? activeSeason.id : '',
      canManageSeasonRecommendations: isPrivilegedUser(req.session.user),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al obtener informe:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el informe.');
    return res.redirect('/reports');
  }
});

// Formulario de edición (solo admin)
router.get('/:id/edit', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin ? null : req.session.user.default_club || null;
    const report = await getReportById(id, clubFilter);
    if (!report) {
      req.flash('error', 'Informe no encontrado.');
      return res.redirect('/reports');
    }
    logPageView(req, 'report_edit_form', {
      reportId: Number(id),
      club: report.club || null,
      team: report.team || null,
    });
    return res.render('reports/edit', { report });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar informe para edición:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el informe.');
    return res.redirect('/reports');
  }
});

// Guardar cambios de edición (solo admin)
router.post('/:id/edit', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const data = {
    player_name: req.body.player_name,
    player_surname: req.body.player_surname,
    year: req.body.year || null,
    club: req.body.club,
    team: req.body.team,
    laterality: req.body.laterality,
    contact: req.body.contact,
    pos1: req.body.pos1,
    pos2: req.body.pos2,
    pos3: req.body.pos3,
    pos4: req.body.pos4,
    recommendation: req.body.recommendation,
    info_reliability: req.body.info_reliability || null,
    comments: req.body.comments,
  };

  try {
    const affected = await updateReport(id, data);
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar el informe.');
    } else {
      logAuditEvent(req, 'update', 'report', {
        reportId: Number(id),
        playerName: `${data.player_name} ${data.player_surname}`.trim(),
        team: data.team || null,
        club: data.club || null,
      });
      req.flash('success', 'Informe actualizado correctamente.');
    }
    return res.redirect(`/reports/${id}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar informe:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar el informe.');
    return res.redirect(`/reports/${id}`);
  }
});

// Borrado de informe (solo admin)
router.post('/:id/delete', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const affected = await deleteReport(id);
    if (!affected) {
      req.flash('error', 'No se ha podido borrar el informe.');
    } else {
      logAuditEvent(req, 'delete', 'report', {
        reportId: Number(id),
      });
      req.flash('success', 'Informe borrado correctamente.');
    }
    return res.redirect('/reports');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar informe:', err);
    req.flash('error', 'Ha ocurrido un error al borrar el informe.');
    return res.redirect('/reports');
  }
});

// Borrado múltiple de informes (solo admin)
router.post('/bulk-delete', ensureAdmin, async (req, res) => {
  let { reportIds } = req.body;

  if (!reportIds) {
    req.flash('error', 'No has seleccionado ningún informe para borrar.');
    return res.redirect('/reports');
  }

  if (!Array.isArray(reportIds)) {
    reportIds = [reportIds];
  }

  try {
    const idsToDelete = reportIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));

    // eslint-disable-next-line no-restricted-syntax
    for (const id of idsToDelete) {
      // eslint-disable-next-line no-await-in-loop
      await deleteReport(id);
    }

    logAuditEvent(req, 'bulk_delete', 'report', {
      reportIds: idsToDelete,
      deletedCount: idsToDelete.length,
    });

    if (idsToDelete.length) {
      req.flash('success', 'Informes seleccionados borrados correctamente.');
    } else {
      req.flash('error', 'No se ha borrado ningún informe.');
    }

    return res.redirect('/reports');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error en borrado múltiple de informes:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al borrar los informes seleccionados.',
    );
    return res.redirect('/reports');
  }
});

module.exports = router;
