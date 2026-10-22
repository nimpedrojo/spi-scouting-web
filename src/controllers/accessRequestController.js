const service = require('../services/accessRequestService');
const model = require('../models/accessRequestModel');
const { csrfToken } = require('../middleware/accessRequestProtection');
const logger = require('../services/logger');

function renderForm(req, res, values = {}, errors = [], code = 200) {
  return res.status(code).render('accessRequests/form', {
    pageTitle: 'Solicitar acceso', values, errors, csrf: csrfToken(req), limits: service.LIMITS,
  });
}

function failure(res) {
  // Do not log SQL/parameters: driver errors can include submitted personal data.
  logger.error('Access request operation failed', { action: 'access_request_error' });
  return res.status(503).send('No se ha podido completar la operación. Inténtalo más tarde.');
}

async function submit(req, res) {
  const body = req.body || {};
  // Bots receive the same confirmation but never create a request.
  if (body.website) return res.redirect(303, '/request-access/received');
  const { values, errors } = service.validateRequest(body);
  if (errors.length) return renderForm(req, res, values, errors, 422);
  try {
    await service.submitRequest(values);
    return res.redirect(303, '/request-access/received');
  } catch { return failure(res); }
}

async function list(req, res) {
  const options = service.listOptions(req.query);
  if (!options) return res.status(400).send('Filtro o página no válidos.');
  try {
    const result = await model.listAccessRequests(options);
    return res.render('accessRequests/list', {
      pageTitle: 'Solicitudes de acceso', ...result, ...options, labels: service.STATUS_LABELS,
    });
  } catch { return failure(res); }
}

async function detail(req, res) {
  if (!service.UUID.test(req.params.id)) return res.status(404).send('Solicitud no encontrada.');
  try {
    const item = await model.getAccessRequest(req.params.id);
    if (!item) return res.status(404).send('Solicitud no encontrada.');
    return res.render('accessRequests/detail', {
      pageTitle: 'Solicitud de acceso', item, csrf: csrfToken(req), labels: service.STATUS_LABELS,
    });
  } catch { return failure(res); }
}

async function review(req, res) {
  const input = service.reviewInput(req.params.id, req.body, req.session.user.id);
  if (!input) return res.status(400).send('Acción no válida.');
  try {
    if (!await model.reviewAccessRequest(input)) return res.status(409).send('La solicitud ha cambiado o ya no admite esta acción. Actualiza la página.');
    logger.info('Access request reviewed', { action: 'access_request_review', requestId: input.id, actorId: input.reviewerId, status: input.status });
    return res.redirect(303, `/admin/access-requests/${input.id}`);
  } catch { return failure(res); }
}

module.exports = { renderForm, submit, list, detail, review };
