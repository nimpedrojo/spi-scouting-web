const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../src/app');
const db = require('../src/db');
const { initDatabaseOnce } = require('../src/initDb');

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
    const { email } = await createTestUser({
      name: 'Config Tester',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resPost = await agent.post('/account').send({
      name: 'Config Tester',
      email,
      default_club: 'Cuenta Club',
      default_team: 'Cuenta Equipo',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/account');

    const resAccount = await agent.get('/account');
    expect(resAccount.status).toBe(200);
    expect(resAccount.text).toContain('Mi cuenta');
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
      default_team: '',
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
      default_team: '',
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
});
