const request = require('supertest');
const { randomUUID } = require('node:crypto');
const app = require('../src/app');
const db = require('../src/db');
const { initDatabaseOnce } = require('../src/initDb');
const { createUser } = require('../src/models/userModel');
const model = require('../src/models/accessRequestModel');
const logger = require('../src/services/logger');

const password = 'access-request-test-password';
const actors = {};
let emails;
let ip;
let sequence = 0;
const tokenFrom = res => {
  const match = res.text.match(/name="_csrf" value="([a-f0-9]{64})"/);
  expect(match).not.toBeNull();
  return match[1];
};
function payload(overrides = {}) {
  const email = `request-${randomUUID()}@example.test`;
  emails.push(email);
  return { name: 'Responsable de cantera', email, organization: 'Club solicitante', position: 'Coordinador', message: 'Quiero conocer la plataforma.', privacy: '1', ...overrides };
}
async function form(agent = request.agent(app)) {
  const res = await agent.get('/request-access').set('X-Forwarded-For', ip);
  expect(res.status).toBe(200);
  return { agent, token: tokenFrom(res) };
}
function send(agent, token, body) {
  return agent.post('/request-access').set('X-Forwarded-For', ip).type('form').send({ ...body, _csrf: token });
}
async function login(role) {
  const agent = request.agent(app);
  const res = await agent.post('/login').set('X-Forwarded-For', ip).send({ email: actors[role].email, password });
  expect(res.headers.location).toBe('/dashboard');
  return agent;
}
async function item(overrides = {}) {
  const data = payload(overrides);
  const id = await model.createAccessRequest(data);
  return { id, ...data };
}

beforeAll(async () => {
  await initDatabaseOnce();
  for (const role of ['user', 'admin', 'superadmin']) {
    const email = `request-actor-${randomUUID()}@example.test`;
    actors[role] = { email, id: await createUser({ name: 'Request test actor', email, password, role }) };
  }
});
beforeEach(() => { emails = []; ip = `198.51.100.${++sequence}`; });
afterEach(async () => {
  jest.restoreAllMocks();
  for (const email of emails) await db.query('DELETE FROM access_requests WHERE email = ?', [email.toLowerCase().trim()]);
});
afterAll(async () => {
  for (const actor of Object.values(actors)) await db.query('DELETE FROM users WHERE id = ?', [actor.id]);
  await db.end();
});

describe('Public access requests', () => {
  test('login offers access requests; form is public, private-cache and does not expose clubs/password fields', async () => {
    expect((await request(app).get('/login')).text).toContain('href="/request-access"');
    const res = await request(app).get('/request-access');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('name="password"');
    expect(res.text).not.toContain('<select');
    expect((await request(app).get('/privacy')).text).toContain('Solicitudes de acceso');
  });
  test('creates a normalized UUID request without an account, role, club assignment or authenticated session', async () => {
    const { agent, token } = await form();
    const body = payload();
    const res = await send(agent, token, { ...body, email: ` ${body.email.toUpperCase()} `, role: 'superadmin', club_id: '1' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/request-access/received');
    const [rows] = await db.query('SELECT * FROM access_requests WHERE email = ?', [body.email]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: body.email, status: 'pending', reviewed_by: null, version: 0 });
    expect(rows[0].id).toMatch(/^[a-f0-9-]{36}$/);
    const [users] = await db.query('SELECT id FROM users WHERE email = ?', [body.email]);
    expect(users).toHaveLength(0);
    expect((await agent.get('/account')).headers.location).toBe('/login');
    expect((await agent.get(res.headers.location)).text).toContain('Solicitud recibida');
  });
  test('concurrent duplicates give identical confirmation and preserve the first request', async () => {
    const { agent, token } = await form(); const body = payload();
    const results = await Promise.all([send(agent, token, body), send(agent, token, body)]);
    expect(results.map(r => r.status)).toEqual([303, 303]);
    const changed = await send(agent, token, { ...body, name: 'Attacker overwrite' });
    expect(changed.headers.location).toBe(results[0].headers.location);
    const [rows] = await db.query('SELECT name FROM access_requests WHERE email = ?', [body.email]);
    expect(rows).toEqual([{ name: body.name }]);
  });
  test('an existing account gets the same public confirmation without changing that account', async () => {
    const { agent, token } = await form();
    const body = payload({ email: actors.user.email }); emails.push(actors.user.email);
    expect((await send(agent, token, body)).headers.location).toBe('/request-access/received');
    const [rows] = await db.query('SELECT id, role FROM users WHERE email = ?', [actors.user.email]);
    expect(rows).toEqual([{ id: actors.user.id, role: 'user' }]);
  });
  test('an unauthenticated repeat cannot reopen or overwrite a reviewed request', async () => {
    const data = await item();
    expect(await model.reviewAccessRequest({ id: data.id, status: 'rejected', version: 0, reviewerId: actors.superadmin.id })).toBe(true);
    const { agent, token } = await form();
    expect((await send(agent, token, { ...data, name: 'Replacement', privacy: '1' })).status).toBe(303);
    expect(await model.getAccessRequest(data.id)).toMatchObject({ status: 'rejected', name: data.name, version: 1 });
  });
  test('honeypot returns generic confirmation but stores no request', async () => {
    const { agent, token } = await form(); const body = payload();
    expect((await send(agent, token, { ...body, website: 'bot.test' })).status).toBe(303);
    const [rows] = await db.query('SELECT id FROM access_requests WHERE email = ?', [body.email]);
    expect(rows).toHaveLength(0);
  });
  test.each([
    { name: '' }, { organization: '' }, { email: 'invalid' }, { email: 'x'.repeat(151)+'@a.test' },
    { name: 'x'.repeat(101) }, { organization: 'x'.repeat(151) },
    { position: 'x'.repeat(101) }, { message: 'x'.repeat(1001) },
    { privacy: '0' }, { message: '\u0000' },
  ])('rejects invalid fields without a write (%p)', async overrides => {
    const { agent, token } = await form(); const body = payload(overrides);
    const res = await send(agent, token, body);
    expect(res.status).toBe(422);
    const [rows] = await db.query('SELECT id FROM access_requests WHERE email = ?', [body.email]);
    expect(rows).toHaveLength(0);
  });
  test('rejects arrays/objects and escapes validation redisplay', async () => {
    const { agent, token } = await form();
    const res = await agent.post('/request-access').set('X-Forwarded-For', ip).send({ ...payload(), name: { malicious: 'object' }, message: '<script>attack()</script>', _csrf: token });
    expect(res.status).toBe(422);
    expect(res.text).toContain('&lt;script&gt;attack()&lt;/script&gt;');
    expect(res.text).not.toContain('<script>attack()');
  });
  test('missing and cross-session CSRF are rejected with no write', async () => {
    const { token } = await form(); const body = payload();
    const second = await form();
    expect((await request(app).post('/request-access').send(body)).status).toBe(403);
    expect((await request(app).post('/request-access').send({ ...body, _csrf: token })).status).toBe(403);
    expect((await send(second.agent, token, body)).status).toBe(403);
    const [rows] = await db.query('SELECT id FROM access_requests WHERE email = ?', [body.email]);
    expect(rows).toHaveLength(0);
  });
  test('rate limit returns 429 with Retry-After and does not block login', async () => {
    const { agent, token } = await form(); const body = payload();
    for (let i = 0; i < 5; i++) expect((await send(agent, token, body)).status).toBe(303);
    const res = await send(agent, token, body);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    const loggedIn = await login('user');
    expect((await loggedIn.get('/account')).status).toBe(200);
  });
  test('database failure is not reported as receipt and logs no submitted fields', async () => {
    const { agent, token } = await form(); const body = payload();
    jest.spyOn(model, 'createAccessRequest').mockRejectedValueOnce(new Error(`SQL with ${body.email} ${body.message}`));
    const log = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await send(agent, token, body);
    expect(res.status).toBe(503);
    expect(res.text).not.toContain(body.email);
    expect(JSON.stringify(log.mock.calls)).not.toContain(body.email);
    expect(JSON.stringify(log.mock.calls)).not.toContain(body.message);
  });
  test('register GET and POST can no longer create an active user', async () => {
    const body = payload();
    const code = randomUUID();
    const [club] = await db.query('INSERT INTO clubs (name, code) VALUES (?, ?)', ['Access request registration fixture', code]);
    try {
      const res = await request(app).post('/register').send({ ...body, password, password2: password, club_code: code });
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/request-access');
      expect((await request(app).get('/register')).headers.location).toBe('/request-access');
      const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [body.email]);
      expect(rows).toHaveLength(0);
    } finally { await db.query('DELETE FROM clubs WHERE id = ?', [club.insertId]); }
  });
  test('authenticated users retain their normal dashboard flow', async () => {
    const agent = await login('user');
    expect((await agent.get('/request-access')).headers.location).toBe('/dashboard');
    expect((await agent.post('/request-access').send(payload())).headers.location).toBe('/dashboard');
    expect((await agent.get('/register')).headers.location).toBe('/dashboard');
  });
});

describe('Platform-only access request administration', () => {
  test('guests cannot list, read or mutate requests', async () => {
    const data = await item();
    for (const path of ['/admin/access-requests', `/admin/access-requests/${data.id}`]) {
      expect((await request(app).get(path)).headers.location).toBe('/login');
    }
    expect((await request(app).post(`/admin/access-requests/${data.id}/status`).send({ status: 'contacted' })).headers.location).toBe('/login');
    expect((await model.getAccessRequest(data.id)).status).toBe('pending');
  });
  test.each(['user', 'admin'])('%s cannot list, read or mutate requests from any club', async role => {
    const agent = await login(role); const data = await item();
    for (const path of ['/admin/access-requests', `/admin/access-requests/${data.id}`]) {
      const res = await agent.get(path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(res.text).not.toContain(data.email);
    }
    expect((await agent.post(`/admin/access-requests/${data.id}/status`).send({ status: 'rejected' })).headers.location).toBe('/');
    expect((await model.getAccessRequest(data.id)).status).toBe('pending');
  });
  test('superadmin can filter/paginate and see the pending counter on the platform page', async () => {
    const agent = await login('superadmin');
    for (let i = 0; i < 21; i++) await item();
    const res = await agent.get('/admin/access-requests');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.text.match(/aria-label="Ver solicitud de/g) || [])).toHaveLength(20);
    expect(res.text).toContain('Siguiente');
    const page2 = await agent.get('/admin/access-requests?page=2');
    expect((page2.text.match(/aria-label="Ver solicitud de/g) || [])).toHaveLength(1);
    expect((await agent.get('/admin/access-requests?status=rejected')).text).toContain('No hay solicitudes');
    expect((await agent.get('/admin/platform')).text).toContain('Solicitudes de acceso <span class="badge text-bg-primary">21</span>');
  });
  test.each(['?status=superadmin', '?page=0', '?page=1%20OR%201=1', '?status[]=pending', '?page[]=1'])('rejects malformed list options (%s)', async query => {
    const agent = await login('superadmin');
    expect((await agent.get('/admin/access-requests'+query)).status).toBe(400);
  });
  test('detail escapes input, state changes require CSRF, and stale reviews conflict', async () => {
    const data = await item({ name: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>' });
    const agent = await login('superadmin');
    const detail = await agent.get(`/admin/access-requests/${data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('&lt;script&gt;');
    expect(detail.text).not.toContain('<img src=x');
    const token = tokenFrom(detail);
    const path = `/admin/access-requests/${data.id}/status`;
    expect((await agent.post(path).type('form').send({ status: 'contacted', version: '0' })).status).toBe(403);
    expect((await agent.post(path).type('form').send({ _csrf: token, status: 'contacted', version: '0' })).status).toBe(303);
    expect(await model.getAccessRequest(data.id)).toMatchObject({ status: 'contacted', version: 1, reviewed_by: actors.superadmin.id });
    expect((await agent.post(path).type('form').send({ _csrf: token, status: 'rejected', version: '0' })).status).toBe(409);
    expect((await agent.post(path).type('form').send({ _csrf: token, status: 'rejected', version: '1' })).status).toBe(303);
    expect((await model.getAccessRequest(data.id)).status).toBe('rejected');
    expect((await agent.post(path).type('form').send({ _csrf: token, status: 'contacted', version: '2' })).status).toBe(409);
  });
  test('concurrent conflicting reviews allow exactly one version update', async () => {
    const data = await item(); const agent = await login('superadmin');
    const token = tokenFrom(await agent.get(`/admin/access-requests/${data.id}`));
    const responses = await Promise.all(['contacted', 'rejected'].map(status => agent.post(`/admin/access-requests/${data.id}/status`).type('form').send({ _csrf: token, version: '0', status })));
    expect(responses.map(r => r.status).sort()).toEqual([303, 409]);
    expect((await model.getAccessRequest(data.id)).version).toBe(1);
  });
  test('UUIDs, states and versions are validated and unknown requests return 404', async () => {
    const data = await item(); const agent = await login('superadmin');
    expect((await agent.get('/admin/access-requests/not-a-uuid')).status).toBe(404);
    expect((await agent.get(`/admin/access-requests/${randomUUID()}`)).status).toBe(404);
    const token = tokenFrom(await agent.get(`/admin/access-requests/${data.id}`));
    for (const body of [{ status: 'superadmin', version: '0' }, { status: 'contacted', version: '-1' }, { status: 'contacted', version: ['0'] }]) {
      expect((await agent.post(`/admin/access-requests/${data.id}/status`).send({ ...body, _csrf: token })).status).toBe(400);
    }
    expect((await model.getAccessRequest(data.id)).version).toBe(0);
  });
  test('schema initialization is idempotent and preserves requests', async () => {
    const data = await item();
    await model.createAccessRequestsTable();
    await model.createAccessRequestsTable();
    expect((await model.getAccessRequest(data.id)).email).toBe(data.email);
  });
});
