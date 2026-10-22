const { csrfToken, requireCsrf, createRequestLimiter } = require('../src/middleware/accessRequestProtection');

function response() {
  return { set: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
}

describe('Access request protections', () => {
  test('CSRF token is random, session-bound and stable across tabs', () => {
    const req = { session: {} };
    const token = csrfToken(req);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(csrfToken(req)).toBe(token);
    expect(csrfToken({ session: {} })).not.toBe(token);
    const next = jest.fn();
    requireCsrf({ session: req.session, body: { _csrf: token } }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
  test.each([undefined, '', ['a'], {}, 'a'.repeat(63), 'a'.repeat(65)])('rejects malformed CSRF (%p)', token => {
    const res = response(); const next = jest.fn();
    requireCsrf({ session: { accessRequestCsrf: 'a'.repeat(64) }, body: { _csrf: token } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
  test('malformed or expired server token produces 403 rather than an exception', () => {
    for (const expected of [undefined, 'short']) {
      const res = response();
      requireCsrf({ session: { accessRequestCsrf: expected }, body: { _csrf: 'a'.repeat(64) } }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });
  test('allows five submissions, expires its window and does not share IP buckets', () => {
    let time = 1000;
    const limiter = createRequestLimiter({ now: () => time });
    const next = jest.fn(); const res = response();
    for (let i = 0; i < 6; i++) limiter({ ip: 'ip-a' }, res, next);
    expect(next).toHaveBeenCalledTimes(5);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '900');
    limiter({ ip: 'ip-b' }, response(), next);
    expect(next).toHaveBeenCalledTimes(6);
    time += 900001;
    limiter({ ip: 'ip-a' }, response(), next);
    expect(next).toHaveBeenCalledTimes(7);
  });
  test('memory cap fails closed and expired buckets are reclaimed', () => {
    let time = 1000;
    const limiter = createRequestLimiter({ now: () => time, maxEntries: 1 });
    const next = jest.fn();
    limiter({ ip: 'ip-a' }, response(), next);
    const full = response();
    limiter({ ip: 'ip-b' }, full, next);
    expect(full.status).toHaveBeenCalledWith(429);
    time += 900001;
    limiter({ ip: 'ip-b' }, response(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
