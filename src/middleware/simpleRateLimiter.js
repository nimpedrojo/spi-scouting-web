// Simple in-memory rate limiter for short windows (suitable for login protection)
// Note: this is intentionally minimal and not distributed. For production,
// use a store-backed limiter (Redis) or a battle-tested library.
const attempts = new Map();

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_ATTEMPTS = 6; // max attempts per window
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // prune every 5 minutes

function cleanup() {
  const now = Date.now();
  for (const [key, entry] of attempts.entries()) {
    if (now - entry.first > WINDOW_MS * 2) {
      attempts.delete(key);
    }
  }
}

setInterval(cleanup, PRUNE_INTERVAL_MS).unref &&
  setInterval(cleanup, PRUNE_INTERVAL_MS).unref();

module.exports = function simpleRateLimiter(req, res, next) {
  try {
    const key = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const existing = attempts.get(key);
    if (!existing || now - existing.first > WINDOW_MS) {
      attempts.set(key, { count: 1, first: now });
      return next();
    }

    existing.count += 1;
    attempts.set(key, existing);

    if (existing.count > MAX_ATTEMPTS) {
      req.flash("error", "Demasiados intentos. Inténtalo más tarde.");
      return res.redirect("/login");
    }

    return next();
  } catch (e) {
    // Fail open on unexpected errors
    return next();
  }
};
