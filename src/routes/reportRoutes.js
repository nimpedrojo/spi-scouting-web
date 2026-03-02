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
const { getPlayersByTeam } = require('../models/playerModel');

const router = express.Router();

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Debes iniciar sesión.');
    return res.redirect('/login');
  }
  return next();
}

function ensureAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

router.get('/new', ensureAuth, async (req, res) => {
  const defaultClub =
    (req.session.user && req.session.user.default_club) || 'Stadium Venecia';
  const defaultTeam =
    (req.session.user && req.session.user.default_team) || 'Primera Infantil';

  // Intentamos filtrar jugadores por el equipo por defecto; si no hay, se podrán mostrar todos más adelante
  let players = await getPlayersByTeam(defaultTeam);
  if (!players.length) {
    players = await getPlayersByTeam(null);
  }

  res.render('reports/new', {
    formData: {
      club: defaultClub,
      team: defaultTeam,
    },
    validationErrors: {},
    players,
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
      const playersForForm = await getPlayersByTeam(team || null);
      return res.status(400).render('reports/new', {
        formData: req.body,
        validationErrors: {
          player_name: !player_name,
          player_surname: !player_surname,
        },
        players: playersForForm,
      });
    }

    // Valores por defecto de club/equipo desde la sesión (si no se ha rellenado nada)
    const finalClub =
      club || (req.session.user && req.session.user.default_club) || 'Stadium Venecia';
    const finalTeam =
      team || (req.session.user && req.session.user.default_team) || 'Primera Infantil';

    await createReport({
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
    req.flash('success', 'Informe creado correctamente.');
    return res.redirect('/reports/new');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear informe:', err);
    req.flash(
      'error',
      `Ha ocurrido un error al guardar el informe: ${err.message}`,
    );
    const playersForForm = await getPlayersByTeam(team || null);
    return res.status(500).render('reports/new', {
      formData: req.body,
      validationErrors: {},
      players: playersForForm,
    });
  }
});

// Listado de informes (solo admin)
router.get('/', ensureAdmin, async (req, res) => {
  try {
    const reports = await getAllReports();
    res.render('reports/list', { reports });
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
    const reports = await getAllReportsRaw();
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
      'attachment; filename="informes_stv.csv"',
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
    const report = await getReportById(id);
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
router.get('/api/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const report = await getReportById(id);
    if (!report) {
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

// Detalle de informe (solo admin)
router.get('/:id', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const report = await getReportById(id);
    if (!report) {
      req.flash('error', 'Informe no encontrado.');
      return res.redirect('/reports');
    }
    return res.render('reports/detail', { report });
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
    const report = await getReportById(id);
    if (!report) {
      req.flash('error', 'Informe no encontrado.');
      return res.redirect('/reports');
    }
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
