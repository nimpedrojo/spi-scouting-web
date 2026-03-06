const {
  getTemplateFormData,
  listTemplates,
  getTemplateDetail,
  createTemplate,
  updateTemplateForUser,
  deleteTemplateForUser,
} = require('../services/evaluationTemplateService');
const { EVALUATION_TEMPLATE } = require('../services/evaluationTemplate');

function parseTemplateMetrics(body) {
  const metrics = [];
  EVALUATION_TEMPLATE.forEach((area) => {
    area.metrics.forEach((metric, index) => {
      const enabled = body[`metric_enabled_${area.key}_${metric.key}`];
      if (!enabled) {
        return;
      }
      metrics.push({
        area: area.key,
        metricKey: metric.key,
        metricLabel: body[`metric_label_${area.key}_${metric.key}`] || metric.label,
        sortOrder: index + 1,
        isRequired: Boolean(body[`metric_required_${area.key}_${metric.key}`]),
        defaultWeight: body[`metric_weight_${area.key}_${metric.key}`] || null,
      });
    });
  });
  return metrics;
}

async function renderIndex(req, res) {
  try {
    const templates = await listTemplates(req.session.user);
    return res.render('evaluation-templates/index', {
      pageTitle: 'Plantillas de evaluación',
      activeRoute: '/evaluation-templates',
      templates: templates || [],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading evaluation templates', err);
    req.flash('error', 'Ha ocurrido un error al cargar las plantillas.');
    return res.redirect('/dashboard');
  }
}

async function renderNew(req, res) {
  const formData = await getTemplateFormData(req.session.user);
  if (!formData) {
    req.flash('error', 'Debes tener un club activo para gestionar plantillas.');
    return res.redirect('/dashboard');
  }
  return res.render('evaluation-templates/form', {
    pageTitle: 'Nueva plantilla',
    activeRoute: '/evaluation-templates',
    template: null,
    formData,
    errors: [],
    formValues: {},
    formAction: '/evaluation-templates',
    submitLabel: 'Crear plantilla',
  });
}

async function create(req, res) {
  const formData = await getTemplateFormData(req.session.user);
  const payload = {
    name: req.body.name,
    description: req.body.description,
    sectionId: req.body.section_id || null,
    categoryId: req.body.category_id || null,
    isActive: Boolean(req.body.is_active),
    metrics: parseTemplateMetrics(req.body),
  };

  const result = await createTemplate(req.session.user, payload);
  if (result.errors) {
    return res.status(422).render('evaluation-templates/form', {
      pageTitle: 'Nueva plantilla',
      activeRoute: '/evaluation-templates',
      template: null,
      formData,
      errors: result.errors,
      formValues: req.body,
      formAction: '/evaluation-templates',
      submitLabel: 'Crear plantilla',
    });
  }

  req.flash('success', 'Plantilla creada correctamente.');
  return res.redirect(`/evaluation-templates/${result.template.id}`);
}

async function renderShow(req, res) {
  const template = await getTemplateDetail(req.session.user, req.params.id);
  if (!template) {
    req.flash('error', 'Plantilla no encontrada.');
    return res.redirect('/evaluation-templates');
  }
  return res.render('evaluation-templates/show', {
    pageTitle: template.name,
    activeRoute: '/evaluation-templates',
    template,
  });
}

async function renderEdit(req, res) {
  const [template, formData] = await Promise.all([
    getTemplateDetail(req.session.user, req.params.id),
    getTemplateFormData(req.session.user),
  ]);
  if (!template || !formData) {
    req.flash('error', 'Plantilla no encontrada.');
    return res.redirect('/evaluation-templates');
  }
  return res.render('evaluation-templates/form', {
    pageTitle: `Editar ${template.name}`,
    activeRoute: '/evaluation-templates',
    template,
    formData,
    errors: [],
    formValues: {},
    formAction: `/evaluation-templates/${template.id}/update`,
    submitLabel: 'Guardar cambios',
  });
}

async function update(req, res) {
  const [template, formData] = await Promise.all([
    getTemplateDetail(req.session.user, req.params.id),
    getTemplateFormData(req.session.user),
  ]);
  if (!template || !formData) {
    req.flash('error', 'Plantilla no encontrada.');
    return res.redirect('/evaluation-templates');
  }

  const payload = {
    name: req.body.name,
    description: req.body.description,
    sectionId: req.body.section_id || null,
    categoryId: req.body.category_id || null,
    isActive: Boolean(req.body.is_active),
    metrics: parseTemplateMetrics(req.body),
  };
  const result = await updateTemplateForUser(req.session.user, req.params.id, payload);
  if (result.errors) {
    return res.status(422).render('evaluation-templates/form', {
      pageTitle: `Editar ${template.name}`,
      activeRoute: '/evaluation-templates',
      template,
      formData,
      errors: result.errors,
      formValues: req.body,
      formAction: `/evaluation-templates/${template.id}/update`,
      submitLabel: 'Guardar cambios',
    });
  }

  req.flash('success', 'Plantilla actualizada correctamente.');
  return res.redirect(`/evaluation-templates/${req.params.id}`);
}

async function remove(req, res) {
  const affected = await deleteTemplateForUser(req.session.user, req.params.id);
  if (!affected) {
    req.flash('error', 'Plantilla no encontrada.');
  } else {
    req.flash('success', 'Plantilla eliminada correctamente.');
  }
  return res.redirect('/evaluation-templates');
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
