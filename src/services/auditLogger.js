const logger = require('./logger');

function buildRequestContext(req) {
  const user = req && req.session ? req.session.user : null;

  return {
    userId: user ? user.id : null,
    userEmail: user ? user.email : null,
    userRole: user ? user.role : null,
    clubId: req && req.session ? req.session.clubId || null : null,
    seasonId: req && req.session ? req.session.seasonId || null : null,
    ip: req ? req.ip : null,
    path: req ? req.originalUrl || req.url : null,
  };
}

function logAuditEvent(req, action, entity, details = {}) {
  logger.info('Audit event', {
    type: 'audit',
    action,
    entity,
    ...buildRequestContext(req),
    ...details,
  });
}

function logPageView(req, page, details = {}) {
  logger.info('Page view', {
    type: 'page_view',
    page,
    ...buildRequestContext(req),
    ...details,
  });
}

module.exports = {
  logAuditEvent,
  logPageView,
};
