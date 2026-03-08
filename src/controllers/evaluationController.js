const multer = require('multer');
const {
  createEvaluationWithScores,
  listEvaluations,
  getPlayerEvaluationsHistory,
  getEvaluationDetail,
  getEvaluationFormData,
} = require('../services/evaluationService');
const { importEvaluationsFromWorkbook } = require('../services/importEvaluationService');
const { buildComparison } = require('../services/comparisonService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function buildGroupedScoresFromBody(body, template) {
  const groupedScores = {};
  template.forEach((area) => {
    groupedScores[area.key] = {};
    area.metrics.forEach((metric) => {
      groupedScores[area.key][metric.key] = body[`score_${area.key}_${metric.key}`];
    });
  });
  return groupedScores;
}

async function renderIndex(req, res) {
  try {
    const filters = {
      teamId: req.query.team_id || null,
      playerId: req.query.player_id || null,
      authorId: req.query.author_id || null,
      dateFrom: req.query.date_from || null,
      dateTo: req.query.date_to || null,
    };
    const result = await listEvaluations(req.session.user, filters);
    return res.render('evaluations/index', {
      pageTitle: 'Evaluaciones',
      activeRoute: '/evaluations',
      groupedEvaluations: result.groupedByTeam,
      filterOptions: result.filterOptions,
      filters,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading evaluations index', err);
    req.flash('error', 'Ha ocurrido un error al cargar las evaluaciones.');
    return res.redirect('/dashboard');
  }
}

async function renderNew(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const formData = await getEvaluationFormData(req.session.user, {
      templateId: req.query.template_id || null,
      teamId: req.query.team_id || null,
      playerId: req.query.player_id || null,
      seasonId: req.query.season_id || (activeSeason ? activeSeason.id : null),
    });
    if (!formData) {
      req.flash('error', 'Configura primero un club por defecto para crear evaluaciones.');
      return res.redirect('/dashboard');
    }
    return res.render('evaluations/new', {
      pageTitle: 'Nueva evaluacion',
      activeRoute: '/evaluations',
      formData,
      formValues: {},
      errors: [],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading new evaluation form', err);
    req.flash('error', 'Ha ocurrido un error al cargar el formulario.');
    return res.redirect('/evaluations');
  }
}

async function create(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const formData = await getEvaluationFormData(req.session.user, {
      templateId: req.body.template_id || null,
      teamId: req.body.team_id || null,
      playerId: req.body.player_id || null,
      seasonId: req.body.season_id || (activeSeason ? activeSeason.id : null),
    });
    const groupedScores = buildGroupedScoresFromBody(req.body, formData.template);
    const payload = {
      seasonId: req.body.season_id || (activeSeason ? activeSeason.id : null),
      teamId: req.body.team_id,
      playerId: req.body.player_id,
      templateId: req.body.template_id,
      evaluationDate: req.body.evaluation_date,
      title: req.body.title,
      notes: req.body.notes,
      source: 'manual',
      groupedScores,
      templateMetrics: formData.template,
    };
    const result = await createEvaluationWithScores(req.session.user, payload);
    if (result.errors && result.errors.length) {
      return res.status(422).render('evaluations/new', {
        pageTitle: 'Nueva evaluacion',
        activeRoute: '/evaluations',
        formData,
        formValues: req.body,
        errors: result.errors,
      });
    }

    req.flash('success', 'Evaluacion creada correctamente.');
    return res.redirect(`/evaluations/${result.evaluation.id}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error creating evaluation', err);
    req.flash('error', 'Ha ocurrido un error al crear la evaluacion.');
    return res.redirect('/evaluations/new');
  }
}

async function renderShow(req, res) {
  try {
    const evaluation = await getEvaluationDetail(req.session.user, req.params.id);
    if (!evaluation) {
      req.flash('error', 'Evaluacion no encontrada.');
      return res.redirect('/evaluations');
    }
    return res.render('evaluations/show', {
      pageTitle: evaluation.title || 'Detalle evaluacion',
      activeRoute: '/evaluations',
      evaluation,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading evaluation detail', err);
    req.flash('error', 'Ha ocurrido un error al cargar la evaluacion.');
    return res.redirect('/evaluations');
  }
}

async function renderPlayerHistory(req, res) {
  try {
    const history = await getPlayerEvaluationsHistory(req.session.user, req.params.id);
    if (!history) {
      req.flash('error', 'Jugador no encontrado.');
      return res.redirect('/evaluations');
    }
    return res.render('evaluations/index', {
      pageTitle: `Historial ${history.player.full_name}`,
      activeRoute: '/evaluations',
      groupedEvaluations: [
        {
          teamId: 'history',
          teamName: 'Historial del jugador',
          total: history.items.length,
          items: history.items.map((item) => ({
            ...item,
            player_full_name: history.player.full_name,
          })),
        },
      ],
      filterOptions: null,
      filters: {},
      playerHistory: history,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading player evaluations history', err);
    req.flash('error', 'Ha ocurrido un error al cargar el historial.');
    return res.redirect('/evaluations');
  }
}

async function importMany(req, res) {
  if (!req.file) {
    req.flash('error', 'Debes seleccionar un fichero Excel.');
    return res.redirect('/evaluations');
  }

  try {
    const summary = await importEvaluationsFromWorkbook(req.session.user, req.file.buffer);
    if (summary.errors.length) {
      req.flash('error', `Importacion completada con incidencias. Creadas: ${summary.created}. Omitidas: ${summary.skipped}.`);
    } else {
      req.flash('success', `Importacion completada. Creadas: ${summary.created}.`);
    }
    return res.redirect('/evaluations');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error importing evaluations', err);
    req.flash('error', 'Ha ocurrido un error al importar evaluaciones.');
    return res.redirect('/evaluations');
  }
}

async function renderCompare(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const comparison = await buildComparison(req.session.user, {
      seasonId: req.query.season_id || (activeSeason ? activeSeason.id : null),
      section: req.query.section || null,
      category: req.query.category || null,
      teamId: req.query.team_id || null,
      playerIds: req.query.player_ids || [],
    });

    return res.render('evaluations/compare', {
      pageTitle: 'Comparativa de jugadores',
      activeRoute: '/evaluations',
      comparison,
      chartJson: comparison && comparison.radarChartData
        ? JSON.stringify(comparison.radarChartData)
        : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading comparison page', err);
    req.flash('error', 'Ha ocurrido un error al cargar la comparativa.');
    return res.redirect('/evaluations');
  }
}

async function submitCompare(req, res) {
  try {
    const activeSeason = req.context ? req.context.activeSeason : null;
    const comparison = await buildComparison(req.session.user, {
      seasonId: req.body.season_id || (activeSeason ? activeSeason.id : null),
      section: req.body.section || null,
      category: req.body.category || null,
      teamId: req.body.team_id || null,
      playerIds: req.body.player_ids || [],
    });

    return res.render('evaluations/compare', {
      pageTitle: 'Comparativa de jugadores',
      activeRoute: '/evaluations',
      comparison,
      chartJson: comparison && comparison.radarChartData
        ? JSON.stringify(comparison.radarChartData)
        : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error submitting comparison', err);
    req.flash('error', 'Ha ocurrido un error al comparar jugadores.');
    return res.redirect('/evaluations/compare');
  }
}

module.exports = {
  upload,
  renderIndex,
  renderNew,
  create,
  renderShow,
  renderPlayerHistory,
  importMany,
  renderCompare,
  submitCompare,
};
