const model = require('../models/accessRequestModel');

const STATUS_LABELS = Object.freeze({ pending: 'Pendiente', contacted: 'Contactada', rejected: 'Rechazada' });
const LIMITS = Object.freeze({ name: 100, email: 150, organization: 150, position: 100, message: 1000 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function validateRequest(body = {}) {
  const values = {};
  const errors = [];
  for (const [field, limit] of Object.entries(LIMITS)) {
    const raw = body[field];
    if (raw !== undefined && typeof raw !== 'string') errors.push('Los campos deben ser texto.');
    const value = typeof raw === 'string' ? raw.trim() : '';
    values[field] = value.slice(0, limit);
    if (value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) errors.push('Hay campos demasiado largos o con caracteres no válidos.');
  }
  values.email = values.email.toLowerCase();
  if (!values.name || !values.organization || !values.email) errors.push('Nombre, email y club u organización son obligatorios.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.push('Introduce un email válido.');
  if (body.privacy !== '1') errors.push('Debes confirmar que has leído la información de privacidad.');
  return { values, errors: [...new Set(errors)] };
}

async function submitRequest(values) {
  return model.createAccessRequest(values);
}

function listOptions(query = {}) {
  if (Object.keys(query).some(key => !['status', 'page'].includes(key))) return null;
  const status = query.status === undefined ? 'pending' : query.status;
  const pageText = query.page === undefined ? '1' : query.page;
  if (typeof status !== 'string' || (status !== '' && !Object.hasOwn(STATUS_LABELS, status))) return null;
  if (typeof pageText !== 'string' || !/^[1-9]\d{0,4}$/.test(pageText)) return null;
  return { status, page: Number(pageText), pageSize: 20 };
}

function reviewInput(id, body = {}, reviewerId) {
  if (!UUID.test(id) || !['contacted', 'rejected'].includes(body.status)
    || typeof body.version !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(body.version)) return null;
  return { id, status: body.status, version: Number(body.version), reviewerId };
}

module.exports = { STATUS_LABELS, LIMITS, UUID, validateRequest, submitRequest, listOptions, reviewInput };
