const { requireClubForUser } = require('./teamService');
const { getAreaLabel } = require('./evaluationAreaHelper');
const { EVALUATION_TEMPLATE, getAllTemplateMetrics } = require('./evaluationTemplate');
const {
  insertEvaluationTemplate,
  findEvaluationTemplateById,
  listEvaluationTemplatesByClub,
  updateEvaluationTemplate,
  deleteEvaluationTemplate,
} = require('../models/evaluationTemplateModel');
const {
  insertTemplateMetrics,
  getTemplateMetrics,
  deleteTemplateMetrics,
} = require('../models/evaluationTemplateMetricModel');
const { getAllSections, findSectionById } = require('../models/sectionModel');
const { getAllCategories, findCategoryById } = require('../models/categoryModel');
const { getTeamsByClubId, findTeamById } = require('../models/teamModel');
const { getPlayerById } = require('../models/playerModel');

function groupMetricsForView(metrics) {
  const grouped = {};
  metrics.forEach((metric) => {
    if (!grouped[metric.area]) {
      grouped[metric.area] = {
        key: metric.area,
        label: getAreaLabel(metric.area),
        metrics: [],
      };
    }
    grouped[metric.area].metrics.push({
      key: metric.metric_key || metric.metricKey,
      label: metric.metric_label || metric.metricLabel,
      isRequired: Boolean(metric.is_required ?? metric.isRequired),
      defaultWeight: metric.default_weight ?? metric.defaultWeight ?? '',
      sortOrder: metric.sort_order || metric.sortOrder,
    });
  });
  return Object.values(grouped);
}

function getDefaultFallbackTemplate() {
  return {
    id: 'fallback-default',
    name: 'Plantilla por defecto',
    description: 'Plantilla base de SoccerReport',
    section_id: null,
    category_id: null,
    section_name: null,
    category_name: null,
    is_active: 1,
    metrics: groupMetricsForView(
      getAllTemplateMetrics().map((metric) => ({
        area: metric.area,
        metric_key: metric.metricKey,
        metric_label: metric.metricLabel,
        sort_order: metric.sortOrder,
        is_required: 1,
        default_weight: null,
      })),
    ),
  };
}

function validateTemplateIntegrity(payload) {
  const errors = [];
  if (!payload.name || !payload.name.trim()) {
    errors.push('El nombre de la plantilla es obligatorio.');
  }
  if (!payload.metrics || !payload.metrics.length) {
    errors.push('Debes definir al menos una metrica.');
  }

  payload.metrics.forEach((metric) => {
    if (!metric.area || !metric.metricKey || !metric.metricLabel) {
      errors.push('Todas las metricas deben incluir area, clave y etiqueta.');
    }
  });

  return errors;
}

async function listTemplates(user) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }
  const templates = await listEvaluationTemplatesByClub(club.id);
  return Promise.all(templates.map(async (template) => ({
    ...template,
    metrics: groupMetricsForView(await getTemplateMetrics(template.id)),
  })));
}

async function getTemplateDetail(user, templateId) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }
  const template = await findEvaluationTemplateById(templateId);
  if (!template || template.club_id !== club.id) {
    return null;
  }
  return {
    ...template,
    metrics: groupMetricsForView(await getTemplateMetrics(templateId)),
  };
}

async function resolveBestTemplateForContext(user, {
  playerId = null,
  teamId = null,
  sectionId = null,
  categoryId = null,
} = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return getDefaultFallbackTemplate();
  }

  let resolvedSectionId = sectionId;
  let resolvedCategoryId = categoryId;

  if (teamId) {
    const team = await findTeamById(teamId);
    if (team && team.club_id === club.id) {
      resolvedSectionId = resolvedSectionId || team.section_id;
      resolvedCategoryId = resolvedCategoryId || team.category_id;
    }
  }

  if (playerId && teamId && (!resolvedSectionId || !resolvedCategoryId)) {
    const player = await getPlayerById(playerId, club.name);
    if (player && player.current_team_id === teamId) {
      const team = await findTeamById(teamId);
      if (team) {
        resolvedSectionId = resolvedSectionId || team.section_id;
        resolvedCategoryId = resolvedCategoryId || team.category_id;
      }
    }
  }

  const templates = await listEvaluationTemplatesByClub(club.id);
  const exact = templates.find((template) => template.is_active
    && template.section_id === resolvedSectionId
    && template.category_id === resolvedCategoryId);
  const categoryOnly = templates.find((template) => template.is_active
    && !template.section_id
    && template.category_id === resolvedCategoryId);
  const sectionOnly = templates.find((template) => template.is_active
    && template.section_id === resolvedSectionId
    && !template.category_id);
  const defaultTemplate = templates.find((template) => template.is_active
    && !template.section_id
    && !template.category_id);
  const resolved = exact || categoryOnly || sectionOnly || defaultTemplate;

  if (!resolved) {
    return getDefaultFallbackTemplate();
  }

  return {
    ...resolved,
    metrics: groupMetricsForView(await getTemplateMetrics(resolved.id)),
  };
}

async function getTemplateFormData(user) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }
  const [sections, categories] = await Promise.all([
    getAllSections(),
    getAllCategories(),
  ]);
  return {
    club,
    sections,
    categories,
    fallbackTemplate: getDefaultFallbackTemplate(),
  };
}

async function createTemplate(user, payload) {
  const club = await requireClubForUser(user);
  if (!club) {
    return { errors: ['Debes tener un club activo para crear plantillas.'] };
  }

  const errors = validateTemplateIntegrity(payload);
  if (payload.sectionId) {
    const section = await findSectionById(payload.sectionId);
    if (!section) {
      errors.push('La seccion seleccionada no es valida.');
    }
  }
  if (payload.categoryId) {
    const category = await findCategoryById(payload.categoryId);
    if (!category) {
      errors.push('La categoria seleccionada no es valida.');
    }
  }

  if (errors.length) {
    return { errors };
  }

  const template = await insertEvaluationTemplate({
    clubId: club.id,
    name: payload.name.trim(),
    description: payload.description || null,
    sectionId: payload.sectionId || null,
    categoryId: payload.categoryId || null,
    isActive: payload.isActive !== false,
  });
  await insertTemplateMetrics(template.id, payload.metrics);
  return { template: await getTemplateDetail(user, template.id) };
}

async function updateTemplateForUser(user, templateId, payload) {
  const template = await getTemplateDetail(user, templateId);
  if (!template) {
    return { errors: ['Plantilla no encontrada.'] };
  }

  const errors = validateTemplateIntegrity(payload);
  if (errors.length) {
    return { errors };
  }

  await updateEvaluationTemplate(templateId, {
    name: payload.name.trim(),
    description: payload.description || null,
    sectionId: payload.sectionId || null,
    categoryId: payload.categoryId || null,
    isActive: payload.isActive !== false,
  });
  await deleteTemplateMetrics(templateId);
  await insertTemplateMetrics(templateId, payload.metrics);
  return { template: await getTemplateDetail(user, templateId) };
}

async function deleteTemplateForUser(user, templateId) {
  const template = await getTemplateDetail(user, templateId);
  if (!template) {
    return 0;
  }
  return deleteEvaluationTemplate(templateId);
}

module.exports = {
  getDefaultFallbackTemplate,
  validateTemplateIntegrity,
  listTemplates,
  getTemplateDetail,
  resolveBestTemplateForContext,
  getTemplateFormData,
  createTemplate,
  updateTemplateForUser,
  deleteTemplateForUser,
};
