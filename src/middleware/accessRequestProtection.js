const { randomBytes, timingSafeEqual } = require('node:crypto');

function csrfToken(req) {
  if (!req.session.accessRequestCsrf) req.session.accessRequestCsrf = randomBytes(32).toString('hex');
  return req.session.accessRequestCsrf;
}

function requireCsrf(req, res, next) {
  const token = req.body && req.body._csrf;
  const expected = req.session.accessRequestCsrf;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
    || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return res.status(403).send('Formulario caducado o no válido. Vuelve a abrir la página.');
  }
  return next();
}

// Separate from the login limiter. Single-process, bounded memory; resets on
// restart and does not claim protection against a distributed botnet.
function createRequestLimiter({ now = Date.now, maxEntries = 10000 } = {}) {
  const entries = new Map();
  const windowMs = 15 * 60 * 1000;
  let lastPrune = 0;
  return (req, res, next) => {
    const time = now();
    if (time - lastPrune >= 60000) {
      for (const [key, value] of entries) if (value.until <= time) entries.delete(key);
      lastPrune = time;
    }
    const key = req.ip || 'unknown';
    let entry = entries.get(key);
    if (entry && entry.until <= time) { entries.delete(key); entry = null; }
    if (!entry && entries.size < maxEntries) {
      entry = { count: 0, until: time + windowMs };
      entries.set(key, entry);
    }
    if (!entry || ++entry.count > 5) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(((entry ? entry.until : time + 60000) - time) / 1000))));
      return res.status(429).send('Demasiadas solicitudes. Inténtalo más tarde.');
    }
    return next();
  };
}

function privateResponse(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  return next();
}

module.exports = { csrfToken, requireCsrf, createRequestLimiter, privateResponse };
