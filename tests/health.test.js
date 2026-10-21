jest.mock('../src/initDb', () => ({
  initDatabaseOnce: jest.fn().mockResolvedValue(),
}));
jest.mock('../src/db', () => ({
  query: jest.fn().mockRejectedValue(new Error('Database unavailable')),
}));
jest.mock('../src/middleware/simpleRateLimiter', () => (_req, _res, next) => next());

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

describe('GET /health', () => {
  test.each([undefined, 'connect.sid=invalid-session'])('is public and independent of database/session context (%s)', async (cookie) => {
    const probe = request(app).get('/health');
    if (cookie) probe.set('Cookie', cookie);
    const res = await probe;

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers.location).toBeUndefined();
    expect(db.query).not.toHaveBeenCalled();
  });
});
