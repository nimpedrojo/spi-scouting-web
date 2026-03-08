const logger = require('../services/logger');

function buildRequestMeta(req, res, durationMs) {
  const user = req.session && req.session.user ? req.session.user : null;

  return {
    type: 'http_request',
    method: req.method,
    path: req.originalUrl || req.url,
    statusCode: res.statusCode,
    durationMs,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: user ? user.id : null,
    userEmail: user ? user.email : null,
    userRole: user ? user.role : null,
    clubId: req.session ? req.session.clubId || null : null,
    seasonId: req.session ? req.session.seasonId || null : null,
  };
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
    const meta = buildRequestMeta(req, res, Number(durationMs.toFixed(2)));

    if (res.statusCode >= 500) {
      logger.error('HTTP request failed', meta);
      return;
    }

    if (req.method !== 'GET' || res.statusCode >= 400) {
      logger.info('HTTP request completed', meta);
      return;
    }

    logger.debug('HTTP request completed', meta);
  });

  next();
}

module.exports = {
  requestLogger,
};
