const request = require('supertest');
const { randomUUID } = require('crypto');
const XLSX = require('xlsx');
const app = require('../src/app');
const db = require('../src/db');
const { initDatabaseOnce } = require('../src/initDb');
const { resolveBestTemplateForContext } = require('../src/services/evaluationTemplateService');

async function createTestClub(name) {
  const code = `club_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const [result] = await db.query(
    'INSERT INTO clubs (name, code) VALUES (?, ?)',
    [name, code],
  );
  return { id: result.insertId, name, code };
}

async function createTestUser({
  name = 'Test User',
  email,
  password = 'password123',
  role = 'user',
  defaultClub = null,
  defaultTeam = null,
}) {
  const userEmail =
    email || `user_${Date.now()}_${Math.random().toString(16).slice(2)}@local`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role, default_club, default_team) VALUES (?, ?, ?, ?, ?, ?)',
    [
      name,
      userEmail,
      // bcryptjs hash for 'password123' con salt 10 (precalculado para evitar coste en tests)
      '$2b$10$dqViRKNFig.H8Ewz7IcQf.eiq..3sKjdfT9lsbHPq1xHSnzM6Sjsi',
      role,
      defaultClub,
      defaultTeam,
    ],
  );
  return { id: result.insertId, email: userEmail, password };
}

function buildEvaluationPayload(overrides = {}) {
  return {
    title: 'Seguimiento semanal',
    notes: 'Buen rendimiento general.',
    evaluation_date: '2026-03-01',
    score_tecnica_control: '7',
    score_tecnica_pase: '8',
    score_tecnica_golpeo: '6',
    score_tecnica_conduccion: '7',
    score_tactica_posicionamiento: '8',
    score_tactica_comprension_juego: '7',
    score_tactica_toma_decisiones: '6',
    score_tactica_desmarques: '7',
    score_fisica_velocidad: '8',
    score_fisica_resistencia: '7',
    score_fisica_coordinacion: '8',
    score_fisica_fuerza: '6',
    score_psicologica_concentracion: '8',
    score_psicologica_competitividad: '8',
    score_psicologica_confianza: '7',
    score_psicologica_reaccion_error: '7',
    score_personalidad_compromiso: '9',
    score_personalidad_companerismo: '8',
    score_personalidad_escucha: '8',
    score_personalidad_disciplina: '9',
    ...overrides,
  };
}

function buildEvaluationWorkbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Evaluaciones');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('Aplicación SoccerReport', () => {
  beforeAll(async () => {
    await initDatabaseOnce();
  });

  afterAll(async () => {
    await db.end();
  });

  async function createTeamContext(baseName = 'Club Plantillas') {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const club = await createTestClub(`${baseName} ${suffix}`);
    const admin = await createTestUser({
      name: `Admin ${suffix}`,
      role: 'admin',
      defaultClub: club.name,
    });

    const [sectionRows] = await db.query(
      'SELECT id, name FROM sections WHERE name IN ("Masculina", "Femenina")',
    );
    const [categoryRows] = await db.query(
      'SELECT id, name FROM categories WHERE name IN ("Juvenil", "Cadete", "Infantil")',
    );
    const [seasonRows] = await db.query(
      'SELECT id, name FROM seasons WHERE club_id = ? ORDER BY created_at DESC',
      [club.id],
    );

    let season = seasonRows[0];
    if (!season) {
      const seasonId = randomUUID();
      await db.query(
        'INSERT INTO seasons (id, club_id, name, is_active) VALUES (?, ?, ?, 1)',
        [seasonId, club.id, '2026/27'],
      );
      season = { id: seasonId, name: '2026/27' };
    }

    return {
      club,
      admin,
      season,
      masculina: sectionRows.find((row) => row.name === 'Masculina'),
      femenina: sectionRows.find((row) => row.name === 'Femenina'),
      juvenil: categoryRows.find((row) => row.name === 'Juvenil'),
      cadete: categoryRows.find((row) => row.name === 'Cadete'),
      infantil: categoryRows.find((row) => row.name === 'Infantil'),
    };
  }

  async function createEvaluationContext(baseName = 'Club Evaluaciones') {
    const context = await createTeamContext(baseName);
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Eval',
      ],
    );

    const [playerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ['Mario', 'Sanz', context.club.name, context.club.id, teamId, 'Juvenil Eval'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), teamId, playerResult.insertId, '10', 'MC'],
    );

    return {
      ...context,
      teamId,
      playerId: playerResult.insertId,
    };
  }

  async function createSeasonComparisonContext(baseName = 'Club Season Compare') {
    const context = await createTeamContext(baseName);
    const secondSeasonId = randomUUID();
    await db.query(
      'INSERT INTO seasons (id, club_id, name, is_active) VALUES (?, ?, ?, 0)',
      [secondSeasonId, context.club.id, '2025/26'],
    );
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [teamId, context.club.id, context.season.id, context.masculina.id, context.juvenil.id, 'Juvenil Compara'],
    );
    const [playerResult] = await db.query(
      `INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Sergio', 'Compara', context.club.name, context.club.id, teamId, 'Juvenil Compara'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), teamId, playerResult.insertId, '8', 'MC'],
    );
    return {
      ...context,
      teamId,
      playerId: playerResult.insertId,
      secondSeasonId,
    };
  }

  async function createForecastContext(baseName = 'Club Forecast') {
    const context = await createEvaluationContext(baseName);
    const [secondPlayerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, birth_year, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ['Pablo', 'Proyeccion', context.club.name, context.club.id, context.teamId, 'Juvenil Eval', 2011],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), context.teamId, secondPlayerResult.insertId, '7', 'EI'],
    );

    await db.query(
      'UPDATE players SET birth_year = ? WHERE id = ?',
      [2010, context.playerId],
    );

    return {
      ...context,
      secondPlayerId: secondPlayerResult.insertId,
    };
  }

  async function seedEvaluationScoresForEvaluation(evaluationId, values = {}) {
    const defaults = {
      tecnica_control: 7,
      tecnica_pase: 8,
      tecnica_golpeo: 6,
      tecnica_conduccion: 7,
      tactica_posicionamiento: 8,
      tactica_comprension_juego: 7,
      tactica_toma_decisiones: 6,
      tactica_desmarques: 7,
      fisica_velocidad: 8,
      fisica_resistencia: 7,
      fisica_coordinacion: 8,
      fisica_fuerza: 6,
      psicologica_concentracion: 8,
      psicologica_competitividad: 8,
      psicologica_confianza: 7,
      psicologica_reaccion_error: 7,
      personalidad_compromiso: 9,
      personalidad_companerismo: 8,
      personalidad_escucha: 8,
      personalidad_disciplina: 9,
      ...values,
    };

    const metricMap = [
      ['tecnica', 'control', 'Control', defaults.tecnica_control, 1],
      ['tecnica', 'pase', 'Pase', defaults.tecnica_pase, 2],
      ['tecnica', 'golpeo', 'Golpeo', defaults.tecnica_golpeo, 3],
      ['tecnica', 'conduccion', 'Conduccion', defaults.tecnica_conduccion, 4],
      ['tactica', 'posicionamiento', 'Posicionamiento', defaults.tactica_posicionamiento, 1],
      ['tactica', 'comprension_juego', 'Comprension juego', defaults.tactica_comprension_juego, 2],
      ['tactica', 'toma_decisiones', 'Toma decisiones', defaults.tactica_toma_decisiones, 3],
      ['tactica', 'desmarques', 'Desmarques', defaults.tactica_desmarques, 4],
      ['fisica', 'velocidad', 'Velocidad', defaults.fisica_velocidad, 1],
      ['fisica', 'resistencia', 'Resistencia', defaults.fisica_resistencia, 2],
      ['fisica', 'coordinacion', 'Coordinacion', defaults.fisica_coordinacion, 3],
      ['fisica', 'fuerza', 'Fuerza', defaults.fisica_fuerza, 4],
      ['psicologica', 'concentracion', 'Concentracion', defaults.psicologica_concentracion, 1],
      ['psicologica', 'competitividad', 'Competitividad', defaults.psicologica_competitividad, 2],
      ['psicologica', 'confianza', 'Confianza', defaults.psicologica_confianza, 3],
      ['psicologica', 'reaccion_error', 'Reaccion error', defaults.psicologica_reaccion_error, 4],
      ['personalidad', 'compromiso', 'Compromiso', defaults.personalidad_compromiso, 1],
      ['personalidad', 'companerismo', 'Companerismo', defaults.personalidad_companerismo, 2],
      ['personalidad', 'escucha', 'Escucha', defaults.personalidad_escucha, 3],
      ['personalidad', 'disciplina', 'Disciplina', defaults.personalidad_disciplina, 4],
    ];

    for (const [area, key, label, score, order] of metricMap) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `INSERT INTO evaluation_scores (
          id, evaluation_id, area, metric_key, metric_label, score, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), evaluationId, area, key, label, score, order],
      );
    }
  }

  test('redirección inicial a /login si no hay sesión', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('muestra página de login', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Iniciar sesión');
  });

  test('un usuario no autenticado es redirigido si intenta ver /account', async () => {
    const res = await request(app).get('/account');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('un usuario autenticado es redirigido de / a /dashboard', async () => {
    const { email } = await createTestUser({
      name: 'Dashboard Redirect',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  test('un usuario no autenticado que entra a /dashboard va a /login', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('un usuario autenticado puede ver su página de cuenta', async () => {
    const { email } = await createTestUser({
      name: 'Cuenta Tester',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/account');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Mi cuenta');
    expect(res.text).toContain('Cuenta Tester');
  });

  test('dashboard para usuario normal muestra solo opciones de usuario', async () => {
    const { email } = await createTestUser({
      name: 'User Dashboard',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nuevo informe');
    expect(res.text).toContain('/reports/new');
    expect(res.text).toContain('Mi cuenta');
    expect(res.text).toContain('/account');
    expect(res.text).not.toContain('Gestión de usuarios');
  });

  test('un usuario puede actualizar sus valores por defecto en cuenta', async () => {
    const context = await createEvaluationContext('Cuenta Defaults');
    const { email } = await createTestUser({
      name: 'Config Tester',
      role: 'user',
    });
    await db.query(
      'UPDATE users SET club_id = ?, default_club = ? WHERE email = ?',
      [context.club.id, context.club.name, email],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resPost = await agent.post('/account').send({
      name: 'Config Tester',
      email,
      default_club: context.club.name,
      default_team_id: context.teamId,
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/account');

    const [rows] = await db.query(
      'SELECT default_club, default_team, default_team_id FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].default_club).toBe(context.club.name);
    expect(rows[0].default_team).toBe('Juvenil Eval');
    expect(rows[0].default_team_id).toBe(context.teamId);

    const resAccount = await agent.get('/account');
    expect(resAccount.status).toBe(200);
    expect(resAccount.text).toContain('Mi cuenta');
  });

  test('un usuario puede guardar credenciales de ProcessIQ en su cuenta', async () => {
    const context = await createEvaluationContext('Cuenta ProcessIQ');
    const { email } = await createTestUser({
      name: 'Cuenta ProcessIQ',
      role: 'user',
    });
    await db.query(
      'UPDATE users SET club_id = ?, default_club = ? WHERE email = ?',
      [context.club.id, context.club.name, email],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resPost = await agent.post('/account').send({
      name: 'Cuenta ProcessIQ',
      email,
      default_club: context.club.name,
      default_team_id: context.teamId,
      processiq_username: 'processiq-user',
      processiq_password: 'processiq-pass',
    });
    expect(resPost.status).toBe(302);

    const [rows] = await db.query(
      'SELECT processiq_username, processiq_password FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].processiq_username).toBe('processiq-user');
    expect(rows[0].processiq_password).toBe('processiq-pass');
  });

  test('mi cuenta muestra acceso a la configuración de equipos del club', async () => {
    const { email } = await createTestUser({
      name: 'Account Teams Link',
      role: 'user',
      defaultClub: 'Club Cuenta Link',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/account');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/teams');
    expect(res.text).toContain('/teams/new');
    expect(res.text).toContain('Crear equipo v2');
  });

  test('mi cuenta permite guardar sin equipo por defecto aunque el club aún no tenga plantillas v2', async () => {
    const club = await createTestClub(`Club Cuenta Sin Equipos ${Date.now()}`);
    const { email } = await createTestUser({
      name: 'Config Club Sin Equipos',
      role: 'user',
      defaultClub: club.name,
    });
    await db.query(
      'UPDATE users SET club_id = ? WHERE email = ?',
      [club.id, email],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resPost = await agent.post('/account').send({
      name: 'Config Club Sin Equipos',
      email,
      default_club: club.name,
      default_team_id: '',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/account');

    const [rows] = await db.query(
      'SELECT default_team, default_team_id FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].default_team).toBeNull();
    expect(rows[0].default_team_id).toBeNull();
  });

  test('los valores por defecto de club/equipo se usan al abrir nuevo informe', async () => {
    const { email } = await createTestUser({
      name: 'Defaults Tester',
      role: 'user',
      defaultClub: 'Club Test',
      defaultTeam: 'Equipo Test',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/reports/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('value="Club Test"');
    expect(res.text).toContain('value="Equipo Test"');
  });

  test('si el usuario rellena club/equipo se respetan sobre los valores por defecto', async () => {
    const { email } = await createTestUser({
      name: 'Override Tester',
      role: 'user',
      defaultClub: 'Club Default',
      defaultTeam: 'Equipo Default',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resPost = await agent.post('/reports/new').send({
      player_name: 'Jugador',
      player_surname: 'Prueba',
      club: 'Club Manual',
      team: 'Equipo Manual',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/reports/new');

    const [rows] = await db.query(
      'SELECT club, team FROM reports ORDER BY id DESC LIMIT 1',
    );
    expect(rows[0].club).toBe('Club Manual');
    expect(rows[0].team).toBe('Equipo Manual');
  });

  test('un admin puede ver la página de gestión de usuarios', async () => {
    const { email } = await createTestUser({
      name: 'Admin Tester',
      role: 'admin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Gestión de usuarios');
  });

  test('superadmin puede listar clubes en /clubs', async () => {
    const club = await createTestClub(`Club List ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin Clubs',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const res = await agent.get('/clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Gestión de clubes');
    expect(res.text).toContain(club.name);
  });

  test('admin puede acceder al listado de clubes', async () => {
    const admin = await createTestUser({
      name: 'Admin Clubs Access',
      role: 'admin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const res = await agent.get('/clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Gestión de clubes');
  });

  test('superadmin puede crear club en /clubs', async () => {
    const superadmin = await createTestUser({
      name: 'Superadmin Create Club',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const clubName = `Club Alta ${Date.now()}`;
    const res = await agent.post('/clubs').send({
      name: clubName,
      code: `code_${Date.now()}`,
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/clubs');

    const [rows] = await db.query('SELECT id FROM clubs WHERE name = ?', [clubName]);
    expect(rows).toHaveLength(1);
  });

  test('superadmin puede editar club en /clubs', async () => {
    const club = await createTestClub(`Club Edit ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin Edit Club',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const res = await agent.post(`/clubs/${club.id}/update`).send({
      name: 'Club Editado',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/clubs');

    const [rows] = await db.query('SELECT name FROM clubs WHERE id = ?', [club.id]);
    expect(rows[0].name).toBe('Club Editado');
  });

  test('admin puede borrar varios clubes de una vez en /clubs', async () => {
    const admin = await createTestUser({
      name: 'Admin Bulk Clubs',
      role: 'admin',
    });
    const clubA = await createTestClub(`Bulk Club A ${Date.now()}`);
    const clubB = await createTestClub(`Bulk Club B ${Date.now()}`);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const res = await agent.post('/clubs/bulk-delete').send({
      clubIds: [String(clubA.id), String(clubB.id)],
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/clubs');

    const [rows] = await db.query(
      'SELECT id FROM clubs WHERE id IN (?, ?)',
      [clubA.id, clubB.id],
    );
    expect(rows).toHaveLength(0);
  });

  test('el borrado múltiple de clubes elimina antes equipos y temporadas asociadas', async () => {
    const admin = await createTestUser({
      name: 'Admin Bulk Clubs Dependencies',
      role: 'admin',
    });
    const club = await createTestClub(`Bulk Club Dependencies ${Date.now()}`);
    const [sectionRows] = await db.query(
      'SELECT id, name FROM sections WHERE name IN ("Masculina")',
    );
    const [categoryRows] = await db.query(
      'SELECT id, name FROM categories WHERE name IN ("Juvenil")',
    );
    const seasonId = randomUUID();
    const teamId = randomUUID();

    await db.query(
      'INSERT INTO seasons (id, club_id, name, is_active) VALUES (?, ?, ?, 1)',
      [seasonId, club.id, '2026/27', 1],
    );
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [teamId, club.id, seasonId, sectionRows[0].id, categoryRows[0].id, 'Juvenil Dependencias'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const res = await agent.post('/clubs/bulk-delete').send({
      clubIds: [String(club.id)],
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/clubs');

    const [clubRows] = await db.query('SELECT id FROM clubs WHERE id = ?', [club.id]);
    const [seasonRowsAfter] = await db.query('SELECT id FROM seasons WHERE id = ?', [seasonId]);
    const [teamRowsAfter] = await db.query('SELECT id FROM teams WHERE id = ?', [teamId]);
    expect(clubRows).toHaveLength(0);
    expect(seasonRowsAfter).toHaveLength(0);
    expect(teamRowsAfter).toHaveLength(0);
  });

  test('dashboard para admin muestra opciones de admin', async () => {
    const { email } = await createTestUser({
      name: 'Admin Dashboard',
      role: 'admin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nuevo informe');
    expect(res.text).toContain('/reports/new');
    expect(res.text).toContain('Mi cuenta');
    expect(res.text).toContain('/account');
    expect(res.text).toContain('Listado de informes');
    expect(res.text).toContain('/reports');
    expect(res.text).toContain('Gestión de usuarios');
    expect(res.text).toContain('/admin/users');
    expect(res.text).toContain('/admin/players');
    expect(res.text).toContain('Jugadores');
    expect(res.text).toContain('/img/report.svg');
  });

  test('un admin puede ver la página de gestión de jugadores', async () => {
    const { email } = await createTestUser({
      name: 'Admin Players',
      role: 'admin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/admin/players');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Base de jugadores');
  });

  test('un no admin no puede acceder a la gestión de jugadores', async () => {
    const { email } = await createTestUser({
      name: 'User Players',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/admin/players');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('un no admin no puede acceder a la gestión de usuarios', async () => {
    const { email } = await createTestUser({
      name: 'User Tester',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/admin/users');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('un admin puede editar datos básicos de un usuario', async () => {
    const admin = await createTestUser({
      name: 'Admin Edit',
      role: 'admin',
    });
    const user = await createTestUser({
      name: 'User To Edit',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const resPost = await agent.post(`/admin/users/${user.id}/edit`).send({
      name: 'User Edited',
      email: user.email,
      default_club: '',
      default_team_id: '',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query(
      'SELECT name, default_club, default_team FROM users WHERE id = ?',
      [user.id],
    );
    expect(rows[0].name).toBe('User Edited');
    // El club/equipo por defecto se valida contra equipos configurados en el club,
    // así que aquí no comprobamos esos campos explícitamente.
  });

  test('superadmin puede crear usuario con asignación de club', async () => {
    const club = await createTestClub(`Club User Create ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin Create User',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const email = `club_user_${Date.now()}@local`;
    const resPost = await agent.post('/admin/users').send({
      name: 'Usuario Club',
      email,
      password: 'password123',
      club_id: String(club.id),
      default_team_id: '',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toMatch(/^\/admin\/users\/\d+\/edit$/);

    const [rows] = await db.query(
      'SELECT club_id, default_club FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].club_id).toBe(club.id);
    expect(rows[0].default_club).toBe(club.name);
  });

  test('formulario de usuario muestra enlace a Plantillas v2', async () => {
    const club = await createTestClub(`Club User Form Link ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin User Form Link',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const [userResult] = await db.query(
      'INSERT INTO users (name, email, password_hash, role, club_id, default_club) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'User Form Link',
        `user_form_link_${Date.now()}@local`,
        '$2b$10$dqViRKNFig.H8Ewz7IcQf.eiq..3sKjdfT9lsbHPq1xHSnzM6Sjsi',
        'user',
        club.id,
        club.name,
      ],
    );

    const res = await agent.get(`/admin/users/${userResult.insertId}/edit`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('/teams');
    expect(res.text).toContain('/teams/new');
    expect(res.text).toContain('Crear equipo');
  });

  test('superadmin puede crear usuario con club aunque ese club aún no tenga plantillas v2', async () => {
    const club = await createTestClub(`Club User No Teams ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin Create User No Teams',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const email = `club_user_no_teams_${Date.now()}@local`;
    const resPost = await agent.post('/admin/users').send({
      name: 'Usuario Sin Equipos Legacy',
      email,
      password: 'password123',
      club_id: String(club.id),
      default_team_id: '',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toMatch(/^\/admin\/users\/\d+\/edit$/);

    const [rows] = await db.query(
      'SELECT club_id, default_club, default_team, default_team_id FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].club_id).toBe(club.id);
    expect(rows[0].default_club).toBe(club.name);
    expect(rows[0].default_team).toBeNull();
    expect(rows[0].default_team_id).toBeNull();
  });

  test('superadmin puede crear usuario con equipo por defecto de Plantillas v2', async () => {
    const context = await createEvaluationContext('User Default Team V2');
    const superadmin = await createTestUser({
      name: 'Superadmin Create User With Team',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const email = `club_user_team_v2_${Date.now()}@local`;
    const resPost = await agent.post('/admin/users').send({
      name: 'Usuario Equipo V2',
      email,
      password: 'password123',
      club_id: String(context.club.id),
      default_team_id: context.teamId,
    });
    expect(resPost.status).toBe(302);

    const [rows] = await db.query(
      'SELECT club_id, default_club, default_team, default_team_id FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].club_id).toBe(context.club.id);
    expect(rows[0].default_club).toBe(context.club.name);
    expect(rows[0].default_team).toBe('Juvenil Eval');
    expect(rows[0].default_team_id).toBe(context.teamId);
  });

  test('superadmin puede editar la asignación de club de un usuario', async () => {
    const clubA = await createTestClub(`Club User Edit A ${Date.now()}`);
    const clubB = await createTestClub(`Club User Edit B ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin Edit User Club',
      role: 'superadmin',
    });
    const user = await createTestUser({
      name: 'User Club Target',
      role: 'user',
      defaultClub: clubA.name,
    });
    await db.query('UPDATE users SET club_id = ? WHERE id = ?', [clubA.id, user.id]);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const resPost = await agent.post(`/admin/users/${user.id}/edit`).send({
      name: 'User Club Target',
      email: user.email,
      club_id: String(clubB.id),
      default_club: clubB.name,
      default_team_id: '',
      new_password: '',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query(
      'SELECT club_id, default_club FROM users WHERE id = ?',
      [user.id],
    );
    expect(rows[0].club_id).toBe(clubB.id);
    expect(rows[0].default_club).toBe(clubB.name);
  });

  test('un admin puede cambiar la contraseña de un usuario', async () => {
    const admin = await createTestUser({
      name: 'Admin Change Pwd',
      role: 'admin',
    });
    const user = await createTestUser({
      name: 'User Change Pwd',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    const resPost = await agent.post(`/admin/users/${user.id}/edit`).send({
      name: 'User Change Pwd',
      email: user.email,
      default_club: '',
      default_team_id: '',
      new_password: 'newpassword123',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const loginRes = await request(app)
      .post('/login')
      .send({ email: user.email, password: 'newpassword123' });
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toBe('/dashboard');
  });

  test('un admin puede cambiar el rol de un usuario', async () => {
    const admin = await createTestUser({
      name: 'Admin Role',
      role: 'admin',
    });
    const user = await createTestUser({
      name: 'User Role',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const resPost = await agent
      .post(`/admin/users/${user.id}/role`)
      .send({ role: 'admin' });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query('SELECT role FROM users WHERE id = ?', [
      user.id,
    ]);
    expect(rows[0].role).toBe('admin');
  });

  test('un admin puede borrar un usuario diferente a sí mismo', async () => {
    const admin = await createTestUser({
      name: 'Admin Delete',
      role: 'admin',
    });
    const user = await createTestUser({
      name: 'User Delete',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const resPost = await agent
      .post(`/admin/users/${user.id}/delete`)
      .send();
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query('SELECT id FROM users WHERE id = ?', [
      user.id,
    ]);
    expect(rows.length).toBe(0);
  });

  test('un admin puede borrar varios usuarios de una vez', async () => {
    const admin = await createTestUser({
      name: 'Admin Bulk',
      role: 'admin',
    });
    const user1 = await createTestUser({
      name: 'User Bulk 1',
      role: 'user',
    });
    const user2 = await createTestUser({
      name: 'User Bulk 2',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const resPost = await agent.post('/admin/users/bulk-delete').send({
      userIds: [String(user1.id), String(user2.id)],
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query(
      'SELECT id FROM users WHERE id IN (?, ?)',
      [user1.id, user2.id],
    );
    expect(rows.length).toBe(0);
  });

  test('el borrado múltiple de usuarios desvincula sus informes (created_by = NULL)', async () => {
    const admin = await createTestUser({
      name: 'Admin Bulk FK',
      role: 'admin',
    });
    const user1 = await createTestUser({
      name: 'User With Reports 1',
      role: 'user',
    });
    const user2 = await createTestUser({
      name: 'User With Reports 2',
      role: 'user',
    });

    // Creamos informes ligados a esos usuarios
    await db.query(
      'INSERT INTO reports (player_name, player_surname, created_by) VALUES (?, ?, ?)',
      ['JugadorA', 'Test', user1.id],
    );
    await db.query(
      'INSERT INTO reports (player_name, player_surname, created_by) VALUES (?, ?, ?)',
      ['JugadorB', 'Test', user2.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const resPost = await agent.post('/admin/users/bulk-delete').send({
      userIds: [String(user1.id), String(user2.id)],
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [userRows] = await db.query(
      'SELECT id FROM users WHERE id IN (?, ?)',
      [user1.id, user2.id],
    );
    expect(userRows.length).toBe(0);

    const [reportRows] = await db.query(
      'SELECT created_by FROM reports WHERE player_name IN (?, ?) AND created_by IS NOT NULL',
      ['JugadorA', 'JugadorB'],
    );
    expect(reportRows.length).toBe(0);
  });

  test('un admin puede borrar varios informes de una vez', async () => {
    const admin = await createTestUser({
      name: 'Admin Reports Bulk',
      role: 'admin',
    });

    // Creamos algunos informes directamente en la BD
    const [insert1] = await db.query(
      'INSERT INTO reports (player_name, player_surname, created_by) VALUES (?, ?, ?)',
      ['Jugador1', 'Bulk', admin.id],
    );
    const [insert2] = await db.query(
      'INSERT INTO reports (player_name, player_surname, created_by) VALUES (?, ?, ?)',
      ['Jugador2', 'Bulk', admin.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const resPost = await agent.post('/reports/bulk-delete').send({
      reportIds: [String(insert1.insertId), String(insert2.insertId)],
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/reports');

    const [rows] = await db.query(
      'SELECT id FROM reports WHERE id IN (?, ?)',
      [insert1.insertId, insert2.insertId],
    );
    expect(rows.length).toBe(0);
  });

  test('un admin puede exportar los informes a CSV con encabezado', async () => {
    const admin = await createTestUser({
      name: 'Admin CSV',
      role: 'admin',
    });

    // Creamos un informe de ejemplo en la BD
    const [insert] = await db.query(
      'INSERT INTO reports (player_name, player_surname, club, team, year) VALUES (?, ?, ?, ?, ?)',
      ['JugadorCSV', 'Apellido', 'Club CSV', 'Equipo CSV', 2010],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const res = await agent.get('/reports/export/csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    const lines = res.text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);

    const header = lines[0].split(',');
    expect(header).toContain('id');
    expect(header).toContain('player_name');
    expect(header).toContain('player_surname');

    const dataLine = lines.find((l) => l.includes('JugadorCSV'));
    expect(dataLine).toBeDefined();
  });

  test('la API de report devuelve 404 si el informe no existe', async () => {
    const res = await request(app).get('/reports/api/999999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('un admin de club puede ver la página de configuración de su club', async () => {
    const { email } = await createTestUser({
      name: 'Club Admin',
      role: 'admin',
      defaultClub: 'Club Config',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/admin/club');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Configuración del club: Club Config');
  });

  test('la configuración de club muestra usuarios, jugadores e informes filtrados por club', async () => {
    const clubName = 'Club Config Data';
    const admin = await createTestUser({
      name: 'Club Admin Data',
      role: 'admin',
      defaultClub: clubName,
    });

    // Usuario de mismo club
    await createTestUser({
      name: 'User Same Club',
      role: 'user',
      defaultClub: clubName,
    });
    // Jugador del club
    await db.query(
      'INSERT INTO players (first_name, last_name, club) VALUES (?, ?, ?)',
      ['JugadorClub', 'Test', clubName],
    );
    // Informe del club
    await db.query(
      'INSERT INTO reports (player_name, player_surname, club) VALUES (?, ?, ?)',
      ['JugadorInforme', 'Test', clubName],
    );

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    const res = await agent.get('/admin/club');
    expect(res.status).toBe(200);
    expect(res.text).toContain('User Same Club');
    expect(res.text).toContain('JugadorClub');
    expect(res.text).toContain('JugadorInforme');
  });

  test('un admin puede crear y gestionar equipos de su club', async () => {
    const clubName = 'Club Equipos';
    const admin = await createTestUser({
      name: 'Club Admin Equipos',
      role: 'admin',
      defaultClub: clubName,
    });

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    // Crear equipo
    const resCreate = await agent.post('/admin/club/teams').send({
      name: 'Equipo A',
    });
    expect(resCreate.status).toBe(302);
    expect(resCreate.headers.location).toBe('/admin/club');

    // Página debería mostrar el equipo
    const resConfig = await agent.get('/admin/club');
    expect(resConfig.status).toBe(200);
    expect(resConfig.text).toContain('Equipo A');
  });

  test('un admin puede previsualizar e importar equipos desde ProcessIQ', async () => {
    const context = await createTeamContext('Club Import ProcessIQ');
    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'team-1',
              name: 'Juvenil Importado',
              section: 'Masculina',
              category: 'Juvenil',
              season: '2026/2027',
            },
            {
              id: 'team-2',
              name: 'Cadete Importado',
              section: 'Femenina',
              category: 'Cadete',
              season: '2026/27',
            },
          ],
        }),
      });

    const previewRes = await agent.post('/teams/import/processiq/preview').send();
    expect(previewRes.status).toBe(200);
    expect(previewRes.text).toContain('Juvenil Importado');
    expect(previewRes.text).toContain('Cadete Importado');

    const res = await agent.post('/teams/import/processiq/confirm').send({
      preview_id: ['0', '1'],
      selected_ids: ['0', '1'],
      name: ['Juvenil Importado', 'Cadete Importado'],
      season_id: [context.season.id, context.season.id],
      section_id: [context.masculina.id, context.femenina.id],
      category_id: [context.juvenil.id, context.cadete.id],
    });

    global.fetch = originalFetch;

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/teams');

    const [rows] = await db.query(
      'SELECT name, source, external_id FROM teams WHERE club_id = ? AND name IN (?, ?) ORDER BY name ASC',
      [context.club.id, 'Juvenil Importado', 'Cadete Importado'],
    );
    expect(rows.map((row) => row.name)).toEqual(['Cadete Importado', 'Juvenil Importado']);
    expect(rows.map((row) => row.source)).toEqual(['processiq', 'processiq']);
    expect(rows.map((row) => row.external_id)).toEqual(['team-2', 'team-1']);
  });

  test('la importación de ProcessIQ omite duplicados existentes', async () => {
    const context = await createTeamContext('Club Import ProcessIQ Duplicate');
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Duplicado',
      ],
    );

    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            name: 'Juvenil Duplicado',
            section: 'Masculina',
            category: 'Juvenil',
            season: context.season.name,
          },
        ]),
      });

    const previewRes = await agent.post('/teams/import/processiq/preview').send();
    expect(previewRes.status).toBe(200);
    expect(previewRes.text).toContain('Duplicado');

    const res = await agent.post('/teams/import/processiq/confirm').send({
      preview_id: ['0'],
      name: ['Juvenil Duplicado'],
      season_id: [context.season.id],
      section_id: [context.masculina.id],
      category_id: [context.juvenil.id],
    });

    global.fetch = originalFetch;

    expect(res.status).toBe(302);

    const [rows] = await db.query(
      'SELECT id FROM teams WHERE club_id = ? AND name = ?',
      [context.club.id, 'Juvenil Duplicado'],
    );
    expect(rows).toHaveLength(1);
  });

  test('la importación de ProcessIQ redirige a cuenta si faltan credenciales', async () => {
    const context = await createTeamContext('Club Import Missing Credentials');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.post('/teams/import/processiq/preview').send();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  test('la importación de ProcessIQ acepta token en accessToken', async () => {
    const context = await createTeamContext('Club Import accessToken');
    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ accessToken: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

    const res = await agent.post('/teams/import/processiq/preview').send();
    global.fetch = originalFetch;

    expect(res.status).toBe(200);
  });

  test('la importación de ProcessIQ acepta token anidado en data.token', async () => {
    const context = await createTeamContext('Club Import nested token');
    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { token: 'token-123' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

    const res = await agent.post('/teams/import/processiq/preview').send();
    global.fetch = originalFetch;

    expect(res.status).toBe(200);
  });

  test('la importación de ProcessIQ acepta token como texto plano', async () => {
    const context = await createTeamContext('Club Import text token');
    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/plain' },
        text: async () => 'token-123',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

    const res = await agent.post('/teams/import/processiq/preview').send();
    global.fetch = originalFetch;

    expect(res.status).toBe(200);
  });

  test('permite cargar jugadores de un equipo importado desde ProcessIQ', async () => {
    const context = await createTeamContext('Club Import ProcessIQ Players');
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name, source, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil API',
        'processiq',
        'ext-team-1',
      ],
    );

    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ accessToken: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ext-team-1',
              name: 'Juvenil API',
              players: [
                { id: 'player-1', dorsal: '9', positions: 'DEL' },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'player-1',
          firstName: 'Pablo',
          lastName: 'García',
          birthYear: 2010,
          preferredFoot: 'Derecha',
          nationality: 'España',
        }),
      });

    const res = await agent.post(`/teams/${teamId}/import-players/processiq`).send();
    global.fetch = originalFetch;

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/teams/${teamId}`);

    const [players] = await db.query(
      'SELECT id, first_name, last_name, source, external_id, current_team_id FROM players WHERE club_id = ? AND external_id = ?',
      [context.club.id, 'player-1'],
    );
    expect(players).toHaveLength(1);
    expect(players[0].first_name).toBe('Pablo');
    expect(players[0].last_name).toBe('García');
    expect(players[0].source).toBe('processiq');
    expect(players[0].current_team_id).toBe(teamId);

    const [links] = await db.query(
      'SELECT dorsal, positions FROM team_players WHERE team_id = ? AND player_id = ?',
      [teamId, players[0].id],
    );
    expect(links).toHaveLength(1);
    expect(links[0].dorsal).toBe('9');
    expect(links[0].positions).toBe('DEL');
  });

  test('importa correctamente jugadores cuando el detalle viene en formato middleware con item.fields', async () => {
    const context = await createTeamContext('Club Teams ProcessIQ Middleware Shape');
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name, source, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.infantil.id,
        'Infantil API',
        'processiq',
        'ext-team-middleware',
      ],
    );

    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ accessToken: 'token-middleware' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ext-team-middleware',
              name: 'Infantil API',
              players: [
                {
                  id: 'player-middleware-1',
                  shortName: 'MARIO',
                  fullName: 'GARCIA LOPEZ, MARIO',
                  dorsal: '8',
                  positions: 'MC, MP',
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          item: {
            id: 'player-middleware-1',
            shortName: 'MARIO',
            fullName: 'GARCIA LOPEZ, MARIO',
            fields: {
              fecha_nacimiento: '01/01/2012',
              lateralidad: 'Derecho',
              nacionalidad: 'Española',
              teléfonos: '600123123',
              posiciones: 'MC, MP',
              'estadistica_conv.': '24',
              'estadistica_tit.': '18',
              'estadistica_supl.': '5',
              'estadistica_s/jug.': '1',
              'estadistica_no_conv.': '2',
              estadistica_minutos: '1460',
              estadistica_goles: '9',
            },
          },
          meta: {
            source: 'gesdep',
          },
        }),
      });

    const res = await agent.post(`/teams/${teamId}/import-players/processiq`).send();
    global.fetch = originalFetch;

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/teams/${teamId}`);

    const [players] = await db.query(
      `SELECT first_name, last_name, birth_year, laterality, nationality, phone, external_id, stats_json
       FROM players
       WHERE club_id = ? AND external_id = ?`,
      [context.club.id, 'player-middleware-1'],
    );
    expect(players).toHaveLength(1);
    expect(players[0].first_name).toBe('MARIO');
    expect(players[0].last_name).toBe('GARCIA LOPEZ');
    expect(players[0].birth_year).toBe(2012);
    expect(players[0].laterality).toBe('DER');
    expect(players[0].nationality).toBe('Española');
    expect(players[0].phone).toBe('600123123');
    expect(JSON.parse(players[0].stats_json)).toEqual({
      callups: 24,
      starts: 18,
      substituteAppearances: 5,
      unusedCallups: 1,
      notCalledUp: 2,
      minutes: 1460,
      goals: 9,
    });
  });

  test('permite editar manualmente las estadisticas de un jugador', async () => {
    const context = await createTeamContext('Club Player Stats Manual');
    const [playerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, birth_year, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ['Mario', 'Manual', context.club.name, context.club.id, context.teamId, 'Juvenil Eval', 2011],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.post(`/admin/players/${playerResult.insertId}/edit`).send({
      first_name: 'Mario',
      last_name: 'Manual',
      team_id: context.teamId,
      dorsal: '6',
      positions: 'MC',
      birth_date: '',
      birth_year: 2011,
      laterality: 'DER',
      phone: '',
      email: '',
      nationality: 'España',
      preferred_foot: 'DER',
      stats_callups: 20,
      stats_starts: 15,
      stats_substitute_appearances: 4,
      stats_unused_callups: 1,
      stats_not_called_up: 2,
      stats_minutes: 1234,
      stats_goals: 7,
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/players');

    const [rows] = await db.query(
      'SELECT stats_json FROM players WHERE id = ?',
      [playerResult.insertId],
    );
    expect(JSON.parse(rows[0].stats_json)).toEqual({
      callups: 20,
      starts: 15,
      substituteAppearances: 4,
      unusedCallups: 1,
      notCalledUp: 2,
      minutes: 1234,
      goals: 7,
    });
  });

  test('el listado de plantillas muestra acción de importar jugadores para equipos ProcessIQ', async () => {
    const context = await createTeamContext('Club Teams ProcessIQ Button');
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name, source, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Sync',
        'processiq',
        'sync-team-1',
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/teams');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Cargar jugadores visibles');
    expect(res.text).toContain(`/teams/${teamId}/import-players/processiq`);
    expect(res.text).toContain('Cargar jugadores');
  });

  test('permite cargar jugadores de forma masiva para los equipos ProcessIQ visibles', async () => {
    const context = await createTeamContext('Club Import ProcessIQ Bulk Players');
    const teamAId = randomUUID();
    const teamBId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name, source, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teamAId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil A API',
        'processiq',
        'bulk-team-1',
        teamBId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil B API',
        'processiq',
        'bulk-team-2',
      ],
    );

    const agent = request.agent(app);
    await db.query(
      'UPDATE users SET processiq_username = ?, processiq_password = ? WHERE id = ?',
      ['processiq-user', 'processiq-pass', context.admin.id],
    );
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ accessToken: 'token-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: 'bulk-team-1', players: [{ id: 'bulk-player-1', dorsal: '7', positions: 'EI' }] },
            { id: 'bulk-team-2', players: [{ id: 'bulk-player-2', dorsal: '5', positions: 'MC' }] },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'bulk-player-1', firstName: 'Luis', lastName: 'Pérez', birthYear: 2011 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ accessToken: 'token-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: 'bulk-team-1', players: [{ id: 'bulk-player-1', dorsal: '7', positions: 'EI' }] },
            { id: 'bulk-team-2', players: [{ id: 'bulk-player-2', dorsal: '5', positions: 'MC' }] },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'bulk-player-2', firstName: 'Mario', lastName: 'Sanz', birthYear: 2010 }),
      });

    const res = await agent.post('/teams/import-players/processiq').send({
      section: 'Masculina',
      category: 'Juvenil',
    });
    global.fetch = originalFetch;

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/teams?section=Masculina&category=Juvenil');

    const [players] = await db.query(
      'SELECT first_name, last_name, current_team_id, external_id FROM players WHERE club_id = ? AND external_id IN (?, ?) ORDER BY external_id ASC',
      [context.club.id, 'bulk-player-1', 'bulk-player-2'],
    );
    expect(players).toHaveLength(2);
    expect(players.map((player) => player.external_id)).toEqual(['bulk-player-1', 'bulk-player-2']);
  });

  test('club config prioriza equipos v2 y deja visible la compatibilidad legacy', async () => {
    const context = await createTeamContext('Club Config Compat');
    await db.query('INSERT INTO club_teams (club, name) VALUES (?, ?)', [context.club.name, 'Legacy Team']);
    const v2TeamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [v2TeamId, context.club.id, context.season.id, context.masculina.id, context.juvenil.id, 'V2 Team'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/admin/club');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Equipos v2 del club (Plantillas)');
    expect(res.text).toContain('V2 Team');
    expect(res.text).toContain('Compatibilidad legacy');
    expect(res.text).toContain('Legacy Team');
  });

  test('session-based operational context still works for /teams', async () => {
    const context = await createTeamContext('Club Session Ops');
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), context.club.id, context.season.id, context.masculina.id, context.juvenil.id, 'Session Team'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/teams');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Plantillas');
    expect(res.text).toContain('Session Team');
  });

  test('un admin puede configurar recomendaciones por año para su club', async () => {
    const clubName = 'Club Recs';
    const admin = await createTestUser({
      name: 'Admin Recs',
      role: 'admin',
      defaultClub: clubName,
    });

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    const resCreateRec = await agent.post('/admin/club/recommendations').send({
      year: 2011,
      options: 'CADETE A,CADETE B',
    });
    expect(resCreateRec.status).toBe(302);
    expect(resCreateRec.headers.location).toBe('/admin/club');

    const resConfig = await agent.get('/admin/club');
    expect(resConfig.status).toBe(200);
    expect(resConfig.text).toContain('Recomendaciones por año');
  });

  test('el formulario de nuevo informe usa recomendaciones de club o por defecto', async () => {
    const clubName = 'Club Informe Recs';
    const admin = await createTestUser({
      name: 'Admin Informe Recs',
      role: 'admin',
      defaultClub: clubName,
    });

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    const resNew = await agent.get('/reports/new');
    expect(resNew.status).toBe(200);
    expect(resNew.text).toContain('name="recommendation"');
  });

  test('un admin puede configurar recomendaciones por año para su club', async () => {
    const clubName = 'Club Recs';
    const admin = await createTestUser({
      name: 'Admin Recs',
      role: 'admin',
      defaultClub: clubName,
    });

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    const resCreateRec = await agent.post('/admin/club/recommendations').send({
      year: 2011,
      options: 'CADETE A,CADETE B',
    });
    expect(resCreateRec.status).toBe(302);
    expect(resCreateRec.headers.location).toBe('/admin/club');

    const resConfig = await agent.get('/admin/club');
    expect(resConfig.status).toBe(200);
    expect(resConfig.text).toContain('Recomendaciones por año');
  });

  test('el formulario de nuevo informe usa recomendaciones de club o por defecto', async () => {
    const clubName = 'Club Informe Recs';
    const admin = await createTestUser({
      name: 'Admin Informe Recs',
      role: 'admin',
      defaultClub: clubName,
    });

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: admin.email, password: 'password123' });

    const resNew = await agent.get('/reports/new');
    expect(resNew.status).toBe(200);
    expect(resNew.text).toContain('name="recommendation"');
  });

  test('GET /teams muestra la página de plantillas', async () => {
    const context = await createTeamContext();
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil A',
      ],
    );

    const res = await agent.get('/teams');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Plantillas');
    expect(res.text).toContain('Juvenil A');
    expect(res.text).toContain('Masculina');
  });

  test('create team crea una plantilla nueva', async () => {
    const context = await createTeamContext();
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post('/teams').send({
      name: 'Cadete B',
      season_id: context.season.id,
      section_id: context.masculina.id,
      category_id: context.cadete.id,
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/teams\//);

    const [rows] = await db.query(
      'SELECT name FROM teams WHERE club_id = ? AND name = ?',
      [context.club.id, 'Cadete B'],
    );
    expect(rows).toHaveLength(1);
  });

  test('view team detail muestra el detalle del equipo', async () => {
    const context = await createTeamContext();
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.femenina.id,
        context.infantil.id,
        'Infantil F',
      ],
    );

    const [playerResult] = await db.query(
      `INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Lucia', 'Pardo', context.club.name, context.club.id, teamId, 'Legacy Team'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), teamId, playerResult.insertId, '7', 'EI'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/teams/${teamId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Infantil F');
    expect(res.text).toContain('Lucia Pardo');
    expect(res.text).toContain('Perfil');
  });

  test('update team actualiza una plantilla', async () => {
    const context = await createTeamContext();
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil C',
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post(`/teams/${teamId}/update`).send({
      name: 'Juvenil C Actualizado',
      season_id: context.season.id,
      section_id: context.masculina.id,
      category_id: context.cadete.id,
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/teams/${teamId}`);

    const [rows] = await db.query(
      'SELECT name, category_id FROM teams WHERE id = ?',
      [teamId],
    );
    expect(rows[0].name).toBe('Juvenil C Actualizado');
    expect(rows[0].category_id).toBe(context.cadete.id);
  });

  test('delete team elimina una plantilla', async () => {
    const context = await createTeamContext();
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Delete',
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post(`/teams/${teamId}/delete`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/teams');

    const [rows] = await db.query('SELECT id FROM teams WHERE id = ?', [teamId]);
    expect(rows).toHaveLength(0);
  });

  test('create evaluation crea una evaluacion manual con sus notas', async () => {
    const context = await createEvaluationContext();
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post('/evaluations').send(buildEvaluationPayload({
      season_id: context.season.id,
      team_id: context.teamId,
      player_id: context.playerId,
    }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/evaluations\//);

    const [evalRows] = await db.query(
      'SELECT overall_score, source FROM evaluations WHERE player_id = ? ORDER BY created_at DESC LIMIT 1',
      [context.playerId],
    );
    expect(evalRows).toHaveLength(1);
    expect(Number(evalRows[0].overall_score)).toBeGreaterThan(0);
    expect(evalRows[0].source).toBe('manual');

    const [scoreRows] = await db.query(
      'SELECT COUNT(*) AS total FROM evaluation_scores es INNER JOIN evaluations e ON e.id = es.evaluation_id WHERE e.player_id = ?',
      [context.playerId],
    );
    expect(scoreRows[0].total).toBe(20);
  });

  test('reject invalid score values devuelve validacion', async () => {
    const context = await createEvaluationContext();
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post('/evaluations').send(buildEvaluationPayload({
      season_id: context.season.id,
      team_id: context.teamId,
      player_id: context.playerId,
      score_tecnica_control: '15',
    }));

    expect(res.status).toBe(422);
    expect(res.text).toContain('debe estar entre 0 y 10');
  });

  test('list evaluations muestra evaluaciones agrupadas', async () => {
    const context = await createEvaluationContext();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
        source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-03-02',
        'manual',
        'Listado test',
        'Notas test',
        7.5,
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/evaluations');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Evaluaciones');
    expect(res.text).toContain('Juvenil Eval');
    expect(res.text).toContain('Mario Sanz');
  });

  test('view player evaluations muestra historial del jugador', async () => {
    const context = await createEvaluationContext();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
        source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-03-03',
        'manual',
        'Historial jugador',
        'Notas historial',
        8.2,
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}/evaluations`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Historial Mario Sanz');
    expect(res.text).toContain('Historial jugador');
  });

  test('import evaluation file success case crea evaluaciones desde Excel', async () => {
    const context = await createEvaluationContext();
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const buffer = buildEvaluationWorkbookBuffer([
      {
        team_name: 'Juvenil Eval',
        player_name: 'Mario Sanz',
        evaluation_date: '2026-03-04',
        source: 'excel',
        title: 'Importada',
        notes: 'Desde xlsx',
        tecnica_control: 7,
        tecnica_pase: 7,
        tecnica_golpeo: 7,
        tecnica_conduccion: 7,
        tactica_posicionamiento: 8,
        tactica_comprension_juego: 8,
        tactica_toma_decisiones: 8,
        tactica_desmarques: 8,
        fisica_velocidad: 6,
        fisica_resistencia: 6,
        fisica_coordinacion: 6,
        fisica_fuerza: 6,
        psicologica_concentracion: 7,
        psicologica_competitividad: 7,
        psicologica_confianza: 7,
        psicologica_reaccion_error: 7,
        personalidad_compromiso: 9,
        personalidad_companerismo: 9,
        personalidad_escucha: 9,
        personalidad_disciplina: 9,
      },
    ]);

    const res = await agent
      .post('/evaluations/import')
      .attach('file', buffer, 'evaluaciones.xlsx');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/evaluations');

    const [rows] = await db.query(
      'SELECT title, source FROM evaluations WHERE player_id = ? AND title = ?',
      [context.playerId, 'Importada'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('excel');
  });

  test('import evaluation file with invalid rows no crea registros validos', async () => {
    const context = await createEvaluationContext();
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const beforeRows = await db.query(
      'SELECT COUNT(*) AS total FROM evaluations WHERE club_id = ?',
      [context.club.id],
    );

    const buffer = buildEvaluationWorkbookBuffer([
      {
        team_name: 'Equipo inexistente',
        player_name: 'Mario Sanz',
        evaluation_date: '2026-03-04',
        tecnica_control: 7,
      },
      {
        team_name: 'Juvenil Eval',
        player_name: 'Mario Sanz',
        evaluation_date: '2026-03-05',
        tecnica_control: 20,
        tecnica_pase: 7,
        tecnica_golpeo: 7,
        tecnica_conduccion: 7,
        tactica_posicionamiento: 8,
        tactica_comprension_juego: 8,
        tactica_toma_decisiones: 8,
        tactica_desmarques: 8,
        fisica_velocidad: 6,
        fisica_resistencia: 6,
        fisica_coordinacion: 6,
        fisica_fuerza: 6,
        psicologica_concentracion: 7,
        psicologica_competitividad: 7,
        psicologica_confianza: 7,
        psicologica_reaccion_error: 7,
        personalidad_compromiso: 9,
        personalidad_companerismo: 9,
        personalidad_escucha: 9,
        personalidad_disciplina: 9,
      },
    ]);

    const res = await agent
      .post('/evaluations/import')
      .attach('file', buffer, 'evaluaciones-invalidas.xlsx');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/evaluations');

    const [[afterCount]] = await db.query(
      'SELECT COUNT(*) AS total FROM evaluations WHERE club_id = ?',
      [context.club.id],
    );
    expect(afterCount.total).toBe(beforeRows[0][0].total);
  });

  test('player profile renders', async () => {
    const context = await createEvaluationContext('Club Perfil');
    await db.query(
      `INSERT INTO reports (
        player_name, player_surname, club, team, overall_rating, created_by
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Mario', 'Sanz', context.club.name, 'Juvenil Eval', 7.8, context.admin.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Mario Sanz');
    expect(res.text).toContain('Informacion personal');
    expect(res.text).toContain('Contexto futbolistico');
    expect(res.text).toContain('Informes');
  });

  test('player profile with evaluations renders analytics and chart', async () => {
    const context = await createEvaluationContext('Club Perfil Eval');
    const evaluationId = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
        source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationId,
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-03-06',
        'manual',
        'Perfil analitico',
        'Notas',
        7.6,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationId);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Media global');
    expect(res.text).toContain('Total evaluaciones');
    expect(res.text).toContain('playerRadarChart');
    expect(res.text).toContain('Tecnica');
  });

  test('player profile empty state without evaluations', async () => {
    const context = await createEvaluationContext('Club Perfil Empty');
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No hay evaluaciones registradas para este jugador');
    expect(res.text).not.toContain('playerRadarChart');
  });

  test('dashboard renders analytics layer', async () => {
    const context = await createEvaluationContext('Club Dashboard Render');
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Jugadores registrados');
    expect(res.text).toContain('Jugadores sin evaluación por equipo');
    expect(res.text).toContain('Juvenil Eval');
  });

  test('dashboard counters with fixtures', async () => {
    const context = await createEvaluationContext('Club Dashboard Counters');
    await db.query(
      `INSERT INTO reports (
        player_name, player_surname, club, team, overall_rating, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Mario', 'Sanz', context.club.name, 'Juvenil Eval', 8.1, context.admin.id, '2026-09-10 10:00:00'],
    );
    const evaluationId = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
        source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationId,
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-10-01',
        'manual',
        'Counter Eval',
        'Notas',
        8.0,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationId);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('1.00');
    expect(res.text).toContain('Informes emitidos');
    expect(res.text).toContain('Equipos activos');
  });

  test('pending evaluations table renders correctly', async () => {
    const context = await createTeamContext('Club Dashboard Pending');
    const teamA = randomUUID();
    const teamB = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        teamA, context.club.id, context.season.id, context.masculina.id, context.juvenil.id, 'Juvenil A',
        teamB, context.club.id, context.season.id, context.masculina.id, context.cadete.id, 'Cadete A',
      ],
    );
    const [p1] = await db.query(
      'INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team) VALUES (?, ?, ?, ?, ?, ?)',
      ['Pedro', 'Uno', context.club.name, context.club.id, teamA, 'Juvenil A'],
    );
    const [p2] = await db.query(
      'INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team) VALUES (?, ?, ?, ?, ?, ?)',
      ['Pedro', 'Dos', context.club.name, context.club.id, teamA, 'Juvenil A'],
    );
    const [p3] = await db.query(
      'INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team) VALUES (?, ?, ?, ?, ?, ?)',
      ['Pedro', 'Tres', context.club.name, context.club.id, teamB, 'Cadete A'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      [
        randomUUID(), teamA, p1.insertId, '6', 'MC',
        randomUUID(), teamA, p2.insertId, '8', 'MC',
        randomUUID(), teamB, p3.insertId, '9', 'DEL',
      ],
    );
    const evaluationId = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
        source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationId,
        context.club.id,
        context.season.id,
        teamA,
        p1.insertId,
        context.admin.id,
        '2026-10-10',
        'manual',
        'Pending test',
        'Notas',
        7.5,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationId);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Juvenil A');
    expect(res.text).toContain('Cadete A');
    expect(res.text).toContain('Pendientes');
    expect(res.text).toContain('50%');
  });

  test('compare page renders', async () => {
    const context = await createEvaluationContext('Club Compare Render');
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/evaluations/compare');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Comparativa de jugadores');
    expect(res.text).toContain('Selecciona al menos 2 jugadores');
  });

  test('comparison with 2 players renders chart and tables', async () => {
    const context = await createEvaluationContext('Club Compare Two');
    const [secondPlayer] = await db.query(
      'INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team) VALUES (?, ?, ?, ?, ?, ?)',
      ['Adrian', 'Lopez', context.club.name, context.club.id, context.teamId, 'Juvenil Eval'],
    );
    await db.query(
      'INSERT INTO team_players (id, team_id, player_id, dorsal, positions) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), context.teamId, secondPlayer.insertId, '11', 'DEL'],
    );

    const evalA = randomUUID();
    const evalB = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evalA, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-11-01', 'manual', 'Comp A', 'Notas', 7.5,
        evalB, context.club.id, context.season.id, context.teamId, secondPlayer.insertId, context.admin.id, '2026-11-01', 'manual', 'Comp B', 'Notas', 8.1,
      ],
    );
    await seedEvaluationScoresForEvaluation(evalA);
    await seedEvaluationScoresForEvaluation(evalB, { tecnica_control: 9, fisica_velocidad: 9 });

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post('/evaluations/compare').send({
      season_id: context.season.id,
      team_id: context.teamId,
      player_ids: [String(context.playerId), String(secondPlayer.insertId)],
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('comparisonRadarChart');
    expect(res.text).toContain('Mario Sanz');
    expect(res.text).toContain('Adrian Lopez');
    expect(res.text).toContain('Comparativa por metrica');
  });

  test('comparison with filters narrows player selector', async () => {
    const context = await createEvaluationContext('Club Compare Filters');
    const otherTeam = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [otherTeam, context.club.id, context.season.id, context.femenina.id, context.infantil.id, 'Infantil Filtro'],
    );
    await db.query(
      'INSERT INTO players (first_name, last_name, club, club_id, current_team_id, team) VALUES (?, ?, ?, ?, ?, ?)',
      ['Laura', 'Fuera', context.club.name, context.club.id, otherTeam, 'Infantil Filtro'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/evaluations/compare?section=Masculina&team_id=${context.teamId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Mario Sanz');
    expect(res.text).not.toContain('Laura Fuera');
  });

  test('empty state with insufficient players', async () => {
    const context = await createEvaluationContext('Club Compare Empty');
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post('/evaluations/compare').send({
      season_id: context.season.id,
      player_ids: [String(context.playerId)],
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Selecciona al menos 2 jugadores');
    expect(res.text).not.toContain('comparisonRadarChart');
  });

  test('create template crea una plantilla de evaluación', async () => {
    const context = await createTeamContext('Club Template Create');
    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post('/evaluation-templates').send({
      name: 'Plantilla Cadete',
      description: 'Template para cadete',
      section_id: context.masculina.id,
      category_id: context.cadete.id,
      is_active: '1',
      metric_enabled_tecnica_control: '1',
      metric_label_tecnica_control: 'Primer control',
      metric_required_tecnica_control: '1',
      metric_weight_tecnica_control: '1',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/evaluation-templates\//);

    const [rows] = await db.query(
      'SELECT name FROM evaluation_templates WHERE club_id = ? AND name = ?',
      [context.club.id, 'Plantilla Cadete'],
    );
    expect(rows).toHaveLength(1);
  });

  test('edit template actualiza una plantilla', async () => {
    const context = await createTeamContext('Club Template Edit');
    const [templateInsert] = await db.query(
      `INSERT INTO evaluation_templates (id, club_id, name, description, section_id, category_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [randomUUID(), context.club.id, 'Template Edit', 'Desc', context.masculina.id, context.juvenil.id],
    );
    const [templateRows] = await db.query(
      'SELECT id FROM evaluation_templates WHERE club_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1',
      [context.club.id, 'Template Edit'],
    );
    const templateId = templateRows[0].id;
    await db.query(
      `INSERT INTO evaluation_template_metrics (
        id, template_id, area, metric_key, metric_label, sort_order, is_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), templateId, 'tecnica', 'control', 'Control', 1, 1],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post(`/evaluation-templates/${templateId}/update`).send({
      name: 'Template Editado',
      description: 'Nueva desc',
      section_id: context.masculina.id,
      category_id: context.cadete.id,
      is_active: '1',
      metric_enabled_tecnica_control: '1',
      metric_label_tecnica_control: 'Control orientado',
      metric_required_tecnica_control: '1',
      metric_weight_tecnica_control: '2',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/evaluation-templates/${templateId}`);

    const [rows] = await db.query(
      'SELECT name, category_id FROM evaluation_templates WHERE id = ?',
      [templateId],
    );
    expect(rows[0].name).toBe('Template Editado');
    expect(rows[0].category_id).toBe(context.cadete.id);
  });

  test('delete template elimina una plantilla', async () => {
    const context = await createTeamContext('Club Template Delete');
    const templateId = randomUUID();
    await db.query(
      `INSERT INTO evaluation_templates (id, club_id, name, is_active)
       VALUES (?, ?, ?, 1)`,
      [templateId, context.club.id, 'Template Delete'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.post(`/evaluation-templates/${templateId}/delete`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/evaluation-templates');

    const [rows] = await db.query('SELECT id FROM evaluation_templates WHERE id = ?', [templateId]);
    expect(rows).toHaveLength(0);
  });

  test('resolve default template usa fallback si no hay plantilla específica', async () => {
    const context = await createEvaluationContext('Club Template Resolve');
    const resolved = await resolveBestTemplateForContext(
      { default_club: context.club.name },
      { teamId: context.teamId, playerId: context.playerId },
    );

    expect(resolved).toBeTruthy();
    expect(resolved.name).toContain('Plantilla');
    expect(resolved.metrics.length).toBeGreaterThan(0);
  });

  test('render evaluation form from template', async () => {
    const context = await createTeamContext('Club Template Render');
    const templateId = randomUUID();
    await db.query(
      `INSERT INTO evaluation_templates (id, club_id, name, description, section_id, category_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [templateId, context.club.id, 'Plantilla Render', 'Desc', context.masculina.id, context.juvenil.id],
    );
    await db.query(
      `INSERT INTO evaluation_template_metrics (
        id, template_id, area, metric_key, metric_label, sort_order, is_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), templateId, 'tecnica', 'control', 'Control Premium', 1, 1],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/evaluations/new?template_id=${templateId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Plantilla Render');
    expect(res.text).toContain('Control Premium');
  });

  test('comparison page renders', async () => {
    const context = await createSeasonComparisonContext('Club Season Index');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/season-comparison');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Comparativa 26/27');
    expect(res.text).toContain('Temporada origen');
  });

  test('player season comparison works', async () => {
    const context = await createSeasonComparisonContext('Club Season Player');
    const evalSource = randomUUID();
    const evalTarget = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evalSource, context.club.id, context.secondSeasonId, context.teamId, context.playerId, context.admin.id, '2025-10-01', 'manual', 'Origen', 'Notas', 6.8,
        evalTarget, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-10-01', 'manual', 'Destino', 'Notas', 7.9,
      ],
    );
    await seedEvaluationScoresForEvaluation(evalSource, { tecnica_control: 6, tactica_posicionamiento: 6 });
    await seedEvaluationScoresForEvaluation(evalTarget, { tecnica_control: 8, tactica_posicionamiento: 8 });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/season-comparison/player/${context.playerId}?source_season_id=${context.secondSeasonId}&target_season_id=${context.season.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Comparativa estacional de jugador');
    expect(res.text).toContain('seasonPlayerRadarChart');
    expect(res.text).toContain('Variación');
  });

  test('team season comparison works', async () => {
    const context = await createSeasonComparisonContext('Club Season Team');
    const evalSource = randomUUID();
    const evalTarget = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evalSource, context.club.id, context.secondSeasonId, context.teamId, context.playerId, context.admin.id, '2025-10-01', 'manual', 'Origen Team', 'Notas', 6.5,
        evalTarget, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-10-01', 'manual', 'Destino Team', 'Notas', 7.7,
      ],
    );
    await seedEvaluationScoresForEvaluation(evalSource);
    await seedEvaluationScoresForEvaluation(evalTarget, { fisica_velocidad: 9 });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/season-comparison/team/${context.teamId}?source_season_id=${context.secondSeasonId}&target_season_id=${context.season.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Comparativa estacional de equipo');
    expect(res.text).toContain('Deltas por área');
    expect(res.text).toContain('Pendientes origen');
  });

  test('empty state when one season has no evaluations', async () => {
    const context = await createSeasonComparisonContext('Club Season Empty');
    const evalTarget = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evalTarget, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-10-01', 'manual', 'Solo destino', 'Notas', 7.4,
      ],
    );
    await seedEvaluationScoresForEvaluation(evalTarget);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/season-comparison/player/${context.playerId}?source_season_id=${context.secondSeasonId}&target_season_id=${context.season.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No hay suficientes datos para comparar este jugador');
  });

  test('forecast page renders', async () => {
    const context = await createForecastContext('Club Forecast Render');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/season-forecast');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Previsión 26/27');
    expect(res.text).toContain('Aplicar filtros');
  });

  test('player forecast works', async () => {
    const context = await createForecastContext('Club Forecast Player');
    const evaluationA = randomUUID();
    const evaluationB = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationA, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-01-15', 'manual', 'Forecast A', 'Notas', 6.4,
        evaluationB, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-03-01', 'manual', 'Forecast B', 'Notas', 8.3,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationA, { tecnica_control: 6, fisica_velocidad: 6 });
    await seedEvaluationScoresForEvaluation(evaluationB, { tecnica_control: 8, fisica_velocidad: 9 });
    await db.query(
      `INSERT INTO reports (player_name, player_surname, club, team, overall_rating, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Mario', 'Sanz', context.club.name, 'Juvenil Eval', 8.2, context.admin.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/season-forecast/player/${context.playerId}?season_id=${context.season.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Previsión individual');
    expect(res.text).toContain('Categoría proyectada');
    expect(res.text).toContain('posible salto');
  });

  test('team forecast works', async () => {
    const context = await createForecastContext('Club Forecast Team');
    const evaluationA = randomUUID();
    const evaluationB = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationA, context.club.id, context.season.id, context.teamId, context.playerId, context.admin.id, '2026-02-01', 'manual', 'Team A', 'Notas', 7.8,
        evaluationB, context.club.id, context.season.id, context.teamId, context.secondPlayerId, context.admin.id, '2026-02-10', 'manual', 'Team B', 'Notas', 6.2,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationA, { tecnica_control: 8 });
    await seedEvaluationScoresForEvaluation(evaluationB, { tecnica_control: 6 });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/season-forecast/team/${context.teamId}?season_id=${context.season.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Previsión de equipo');
    expect(res.text).toContain('Promociones previstas');
    expect(res.text).toContain('Jugadores que necesitan más datos');
  });

  test('insufficient data case works', async () => {
    const context = await createForecastContext('Club Forecast Empty');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/season-forecast/player/${context.secondPlayerId}?season_id=${context.season.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Datos insuficientes');
    expect(res.text).toContain('seguir observando');
  });

  test('PDF route renders', async () => {
    const context = await createEvaluationContext('Club PDF Render');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/players/${context.playerId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`Informe de Mario Sanz`);
    expect(res.text).toContain('Comunicación trimestral');
  });

  test('PDF route works with player with evaluations', async () => {
    const context = await createEvaluationContext('Club PDF Eval');
    const evaluationId = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date, source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationId,
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-03-02',
        'manual',
        'Quarterly Review',
        'Buen trimestre y margen de mejora en ritmo competitivo.',
        7.6,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationId, { tecnica_control: 8, fisica_velocidad: 8 });
    await db.query(
      `INSERT INTO reports (player_name, player_surname, club, team, overall_rating, comments, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Mario', 'Sanz', context.club.name, 'Juvenil Eval', 7.9, 'Comentario de seguimiento para familias.', context.admin.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/players/${context.playerId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Media global');
    expect(res.text).toContain('playerPdfRadarChart');
    expect(res.text).toContain('Comentario del cuerpo técnico');
    expect(res.text).toContain('Buen trimestre y margen de mejora en ritmo competitivo.');
  });

  test('PDF route works with missing optional data', async () => {
    const context = await createEvaluationContext('Club PDF Empty');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/players/${context.playerId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Todavía no hay evaluaciones suficientes');
    expect(res.text).toContain('No hay comentarios recientes disponibles');
    expect(res.text).toContain('Informes registrados');
  });
});
