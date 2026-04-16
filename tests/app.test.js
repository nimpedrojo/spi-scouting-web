const request = require('supertest');
const fsPromises = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const XLSX = require('xlsx');
const app = require('../src/app');
const db = require('../src/db');
const { initDatabaseOnce } = require('../src/initDb');
const { setModuleEnabledForClub } = require('../src/core/models/clubModuleModel');
const { resolveBestTemplateForContext } = require('../src/services/evaluationTemplateService');

const uploadsRoots = [
  path.join(__dirname, '..', 'src', 'public', 'uploads', 'clubs'),
  path.join(__dirname, '..', 'src', 'public', 'uploads', 'players'),
  path.join(__dirname, '..', 'src', 'public', 'uploads', 'planning'),
];

const STATIC_TEST_REPORT_CLUBS = ['Club Manual', 'Club Test', 'Club Default'];

let testState = null;

function buildPlaceholders(values) {
  return values.map(() => '?').join(', ');
}

function formatMysqlDate(value) {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

async function readUploadSnapshot() {
  const snapshot = new Map();

  for (const root of uploadsRoots) {
    try {
      const entries = await fsPromises.readdir(root);
      snapshot.set(root, new Set(entries));
    } catch (_error) {
      snapshot.set(root, new Set());
    }
  }

  return snapshot;
}

async function createTestClub(name) {
  const code = `club_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const [result] = await db.query(
    'INSERT INTO clubs (name, code) VALUES (?, ?)',
    [name, code],
  );
  if (testState) {
    testState.clubIds.add(result.insertId);
    testState.clubNames.add(name);
  }
  return { id: result.insertId, name, code };
}

async function createTestUser({
  name = 'Test User',
  email,
  password = 'password123',
  role = 'user',
  defaultClub = null,
  defaultTeam = null,
  defaultTeamId = null,
}) {
  const userEmail =
    email || `user_${Date.now()}_${Math.random().toString(16).slice(2)}@local`;
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role, default_club, default_team, default_team_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      name,
      userEmail,
      // bcryptjs hash for 'password123' con salt 10 (precalculado para evitar coste en tests)
      '$2b$10$dqViRKNFig.H8Ewz7IcQf.eiq..3sKjdfT9lsbHPq1xHSnzM6Sjsi',
      role,
      defaultClub,
      defaultTeam,
      defaultTeamId,
    ],
  );
  if (testState) {
    testState.userIds.add(result.insertId);
  }
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

describe('Aplicación SoccerProcessIQ Suite', () => {
  beforeAll(async () => {
    await initDatabaseOnce();
  });

  beforeEach(async () => {
    testState = {
      clubIds: new Set(),
      clubNames: new Set(),
      userIds: new Set(),
      uploadSnapshot: await readUploadSnapshot(),
    };
  });

  afterEach(async () => {
    if (!testState) {
      return;
    }

    const clubIds = [...testState.clubIds];
    const clubNames = [...testState.clubNames];
    const userIds = [...testState.userIds];

    let teamIds = [];
    let seasonIds = [];
    let evaluationIds = [];

    if (clubIds.length) {
      const clubPlaceholders = buildPlaceholders(clubIds);
      const [teamRows] = await db.query(
        `SELECT id FROM teams WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      const [seasonRows] = await db.query(
        `SELECT id FROM seasons WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      const [evaluationRows] = await db.query(
        `SELECT id FROM evaluations WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );

      teamIds = teamRows.map((row) => row.id);
      seasonIds = seasonRows.map((row) => row.id);
      evaluationIds = evaluationRows.map((row) => row.id);
    }

    if (userIds.length) {
      const userPlaceholders = buildPlaceholders(userIds);
      const [authorEvaluationRows] = await db.query(
        `SELECT id FROM evaluations WHERE author_id IN (${userPlaceholders})`,
        userIds,
      );
      evaluationIds = [...new Set([
        ...evaluationIds,
        ...authorEvaluationRows.map((row) => row.id),
      ])];
    }

    if (evaluationIds.length) {
      const evaluationPlaceholders = buildPlaceholders(evaluationIds);
      await db.query(
        `DELETE FROM evaluation_scores WHERE evaluation_id IN (${evaluationPlaceholders})`,
        evaluationIds,
      );
      await db.query(
        `DELETE FROM evaluations WHERE id IN (${evaluationPlaceholders})`,
        evaluationIds,
      );
    }

    if (teamIds.length) {
      const teamPlaceholders = buildPlaceholders(teamIds);
      await db.query(
        `DELETE FROM team_players WHERE team_id IN (${teamPlaceholders})`,
        teamIds,
      );
    }

    if (clubIds.length) {
      const clubPlaceholders = buildPlaceholders(clubIds);
      await db.query(
        `DELETE FROM scouting_team_reports WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      await db.query(
        `DELETE FROM scouting_team_opponents WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      await db.query(
        `DELETE FROM evaluation_templates WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      await db.query(
        `DELETE FROM players WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      await db.query(
        `DELETE FROM club_modules WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
      await db.query(
        `DELETE FROM teams WHERE club_id IN (${clubPlaceholders})`,
        clubIds,
      );
    }

    if (userIds.length) {
      const userPlaceholders = buildPlaceholders(userIds);
      await db.query(
        `DELETE FROM scouting_team_reports WHERE created_by IN (${userPlaceholders})`,
        userIds,
      );
      await db.query(
        `DELETE FROM reports WHERE created_by IN (${userPlaceholders})`,
        userIds,
      );
      await db.query(
        `DELETE FROM users WHERE id IN (${userPlaceholders})`,
        userIds,
      );
    }

    if (clubNames.length) {
      const clubNamePlaceholders = buildPlaceholders(clubNames);
      await db.query(
        `DELETE FROM users WHERE default_club IN (${clubNamePlaceholders})`,
        clubNames,
      );
    }

    const reportClubNames = [...new Set([
      ...clubNames,
      ...STATIC_TEST_REPORT_CLUBS,
    ])];
    if (reportClubNames.length) {
      const reportClubPlaceholders = buildPlaceholders(reportClubNames);
      await db.query(
        `DELETE FROM reports WHERE club IN (${reportClubPlaceholders})`,
        reportClubNames,
      );
    }

    if (seasonIds.length) {
      const seasonPlaceholders = buildPlaceholders(seasonIds);
      await db.query(
        `DELETE FROM seasons WHERE id IN (${seasonPlaceholders})`,
        seasonIds,
      );
    }

    if (clubIds.length) {
      const clubPlaceholders = buildPlaceholders(clubIds);
      await db.query(
        `DELETE FROM clubs WHERE id IN (${clubPlaceholders})`,
        clubIds,
      );
    }

    const currentSnapshot = await readUploadSnapshot();
    for (const root of uploadsRoots) {
      const beforeEntries = testState.uploadSnapshot.get(root) || new Set();
      const afterEntries = currentSnapshot.get(root) || new Set();

      for (const entry of afterEntries) {
        if (entry === '.gitkeep' || beforeEntries.has(entry)) {
          continue;
        }

        await fsPromises.unlink(path.join(root, entry)).catch(() => {});
      }
    }

    await db.query(
      'UPDATE platform_settings SET default_product_mode = ? WHERE id = 1',
      ['suite'],
    );

    testState = null;
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

  async function seedTeamBenchmarkFixture(context, options = {}) {
    const secondPlayerName = options.secondPlayerName || ['Luis', 'Medio'];
    const thirdPlayerName = options.thirdPlayerName || ['Pablo', 'Base'];

    const [secondPlayerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [secondPlayerName[0], secondPlayerName[1], context.club.name, context.club.id, context.teamId, 'Juvenil Eval'],
    );
    const [thirdPlayerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [thirdPlayerName[0], thirdPlayerName[1], context.club.name, context.club.id, context.teamId, 'Juvenil Eval'],
    );

    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      [
        randomUUID(), context.teamId, secondPlayerResult.insertId, '8', 'MC',
        randomUUID(), context.teamId, thirdPlayerResult.insertId, '6', 'CENTRAL',
      ],
    );

    const evaluations = [
      {
        id: randomUUID(),
        playerId: context.playerId,
        date: '2026-03-20',
        title: 'Jugador objetivo',
        overall: 7.8,
        scores: {
          tecnica_control: 8,
          tecnica_pase: 8,
          tactica_posicionamiento: 8,
          fisica_velocidad: 7,
          psicologica_concentracion: 8,
          personalidad_compromiso: 9,
        },
      },
      {
        id: randomUUID(),
        playerId: secondPlayerResult.insertId,
        date: '2026-03-18',
        title: 'Jugador medio',
        overall: 6.9,
        scores: {
          tecnica_control: 7,
          tecnica_pase: 7,
          tactica_posicionamiento: 7,
          fisica_velocidad: 7,
          psicologica_concentracion: 7,
          personalidad_compromiso: 7,
        },
      },
      {
        id: randomUUID(),
        playerId: thirdPlayerResult.insertId,
        date: '2026-03-16',
        title: 'Jugador base',
        overall: 6.2,
        scores: {
          tecnica_control: 6,
          tecnica_pase: 6,
          tactica_posicionamiento: 6,
          fisica_velocidad: 6,
          psicologica_concentracion: 6,
          personalidad_compromiso: 6,
        },
      },
    ];

    for (const evaluation of evaluations) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `INSERT INTO evaluations (
          id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
          source, title, notes, overall_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          evaluation.id,
          context.club.id,
          context.season.id,
          context.teamId,
          evaluation.playerId,
          context.admin.id,
          evaluation.date,
          'manual',
          evaluation.title,
          'Benchmark',
          evaluation.overall,
        ],
      );
      // eslint-disable-next-line no-await-in-loop
      await seedEvaluationScoresForEvaluation(evaluation.id, evaluation.scores);
    }

    return {
      secondPlayerId: secondPlayerResult.insertId,
      thirdPlayerId: thirdPlayerResult.insertId,
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

  test('un superadmin ve su cuenta como administración global sin club ni equipo por defecto', async () => {
    const club = await createTestClub(`Club Superadmin Account ${Date.now()}`);
    const { email } = await createTestUser({
      name: 'Superadmin Global',
      role: 'superadmin',
      defaultClub: club.name,
      defaultTeam: 'Equipo Legacy',
    });
    await db.query(
      'UPDATE users SET club_id = ?, default_club = ?, default_team = ? WHERE email = ?',
      [club.id, club.name, 'Equipo Legacy', email],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/account');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Administrador de plataforma');
    expect(res.text).toContain('No trabaja con un club ni un equipo activos por defecto');
    expect(res.text).not.toContain('Club por defecto');
    expect(res.text).not.toContain('Equipo por defecto');
  });

  test('un superadmin puede gestionar el modo global de producto desde plataforma', async () => {
    const superadmin = await createTestUser({
      name: 'Platform Superadmin',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const resPage = await agent.get('/admin/platform');
    expect(resPage.status).toBe(200);
    expect(resPage.text).toContain('Administración de plataforma');
    expect(resPage.text).toContain('Modo de producto global');
    expect(resPage.text).toContain('SPI Player Tracking');

    const resUpdate = await agent.post('/admin/platform/product-mode').send({
      default_product_mode: 'pmv_player_tracking',
    });
    expect(resUpdate.status).toBe(302);
    expect(resUpdate.headers.location).toBe('/admin/platform');

    const [[settingsRow]] = await db.query(
      'SELECT default_product_mode FROM platform_settings WHERE id = 1',
    );
    expect(settingsRow.default_product_mode).toBe('pmv_player_tracking');
  });

  test('dashboard para usuario normal muestra solo opciones de usuario', async () => {
    await db.query(
      'UPDATE platform_settings SET default_product_mode = ? WHERE id = 1',
      ['suite'],
    );
    const { email } = await createTestUser({
      name: 'User Dashboard',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SoccerProcessIQ Suite');
    expect(res.text).toContain('SPI Core');
    expect(res.text).toContain('Módulos activos');
    expect(res.text).toContain('SPI Scouting Players');
    expect(res.text).toContain('Valoraciones');
    expect(res.text).toContain('/assessments');
    expect(res.text).toContain('Nuevo informe');
    expect(res.text).toContain('/reports/new');
    expect(res.text).toContain('Mi cuenta');
    expect(res.text).toContain('/account');
    expect(res.text).toContain('Equipos');
    expect(res.text).toContain('Jugadores');
    expect(res.text).not.toContain('/admin/users');
  });

  test('un usuario autenticado puede ver la landing unificada de valoraciones', async () => {
    const { email } = await createTestUser({
      name: 'Valoraciones User',
      role: 'user',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/assessments');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Valoraciones');
    expect(res.text).toContain('Informes de observacion');
    expect(res.text).toContain('Evaluaciones estructuradas');
    expect(res.text).toContain('/reports');
    expect(res.text).toContain('/evaluations');
    expect(res.text).toContain('Crear evaluacion');
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

  test('un superadmin al guardar su cuenta mantiene club y equipo por defecto vacíos', async () => {
    const club = await createTestClub(`Club Superadmin Save ${Date.now()}`);
    const { email } = await createTestUser({
      name: 'Superadmin Save',
      role: 'superadmin',
    });
    await db.query(
      'UPDATE users SET club_id = ?, default_club = ?, default_team = ?, default_team_id = NULL WHERE email = ?',
      [club.id, club.name, 'Equipo Legacy', email],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resPost = await agent.post('/account').send({
      name: 'Superadmin Save',
      email,
      default_club: club.name,
      default_team_id: '',
      processiq_username: 'processiq-user',
      processiq_password: 'processiq-pass',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/account');

    const [rows] = await db.query(
      'SELECT default_club, default_team, default_team_id, processiq_username FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].default_club).toBeNull();
    expect(rows[0].default_team).toBeNull();
    expect(rows[0].default_team_id).toBeNull();
    expect(rows[0].processiq_username).toBe('processiq-user');
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
    expect(resPost.headers.location).toMatch(/^\/reports\/\d+$/);

    const [rows] = await db.query(
      'SELECT club, team FROM reports ORDER BY id DESC LIMIT 1',
    );
    expect(rows[0].club).toBe('Club Manual');
    expect(rows[0].team).toBe('Equipo Manual');
  });

  test('superadmin crea informes sin heredar club o equipo legacy por defecto', async () => {
    const club = await createTestClub(`Club Legacy Reports ${Date.now()}`);
    const { email } = await createTestUser({
      name: 'Superadmin Reports Global',
      role: 'superadmin',
    });
    await db.query(
      'UPDATE users SET club_id = ?, default_club = ?, default_team = ?, default_team_id = NULL WHERE email = ?',
      [club.id, club.name, 'Equipo Legacy Reports', email],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resForm = await agent.get('/reports/new');
    expect(resForm.status).toBe(200);
    expect(resForm.text).not.toContain('value="Stadium Venecia"');
    expect(resForm.text).not.toContain(`value="${club.name}"`);
    expect(resForm.text).not.toContain('value="Equipo Legacy Reports"');

    const resPost = await agent.post('/reports/new').send({
      player_name: 'Jugador Global',
      player_surname: 'Sin Club',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toMatch(/^\/reports\/\d+$/);

    const [rows] = await db.query(
      'SELECT club, team FROM reports WHERE player_name = ? AND player_surname = ? ORDER BY id DESC LIMIT 1',
      ['Jugador Global', 'Sin Club'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].club).toBeNull();
    expect(rows[0].team).toBe('');
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

  test('admin no puede acceder al listado de clubes', async () => {
    const admin = await createTestUser({
      name: 'Admin Clubs Access',
      role: 'admin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });

    const res = await agent.get('/clubs');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
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

    const [moduleRows] = await db.query(
      'SELECT module_key, enabled FROM club_modules WHERE club_id = ? ORDER BY module_key ASC',
      [rows[0].id],
    );
    expect(moduleRows).toHaveLength(3);
    expect(moduleRows.find((row) => row.module_key === 'scouting_players').enabled).toBe(1);
    expect(moduleRows.find((row) => row.module_key === 'planning').enabled).toBe(0);
    expect(moduleRows.find((row) => row.module_key === 'scouting_teams').enabled).toBe(0);
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

  test('admin no puede borrar varios clubes de una vez en /clubs', async () => {
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
    expect(res.headers.location).toBe('/');

    const [rows] = await db.query(
      'SELECT id FROM clubs WHERE id IN (?, ?)',
      [clubA.id, clubB.id],
    );
    expect(rows).toHaveLength(2);
  });

  test('un superadmin puede borrar clubes y dependencias asociadas', async () => {
    const superadmin = await createTestUser({
      name: 'Superadmin Bulk Clubs Dependencies',
      role: 'superadmin',
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
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

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
    expect(
      res.text.includes('SPI Core') || res.text.includes('¿Qué quieres hacer ahora?'),
    ).toBe(true);
    expect(
      res.text.includes('SPI Scouting Players') || res.text.includes('Evaluar jugador'),
    ).toBe(true);
    expect(res.text).toContain('Administración');
    expect(res.text).toContain('/admin/players');
    expect(res.text).toContain('/admin/club');
    expect(
      res.text.includes('Configuración del club') || res.text.includes('Ver mi perfil'),
    ).toBe(true);
    expect(res.text).not.toContain('/clubs');
  });

  test('si scouting_players está desactivado el dashboard oculta accesos del módulo', async () => {
    const club = await createTestClub(`Club Dashboard Modules ${Date.now()}`);
    const user = await createTestUser({
      name: 'Dashboard Modules User',
      role: 'admin',
      defaultClub: club.name,
    });
    await db.query(
      'UPDATE users SET club_id = ? WHERE id = ?',
      [club.id, user.id],
    );
    await setModuleEnabledForClub(club.id, 'scouting_players', false);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: user.email, password: 'password123' });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sin módulos adicionales activos');
    expect(res.text).not.toContain('SPI Scouting Players');
    expect(res.text).not.toContain('/assessments');
    expect(res.text).not.toContain('/reports/new');
  });

  test('si scouting_players está desactivado se bloquea el acceso a valoraciones con 403', async () => {
    const club = await createTestClub(`Club Module Gate ${Date.now()}`);
    const user = await createTestUser({
      name: 'Module Gate User',
      role: 'user',
      defaultClub: club.name,
    });
    await db.query(
      'UPDATE users SET club_id = ? WHERE id = ?',
      [club.id, user.id],
    );
    await setModuleEnabledForClub(club.id, 'scouting_players', false);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: user.email, password: 'password123' });

    const res = await agent.get('/assessments');
    expect(res.status).toBe(403);
    expect(res.text).toContain('MODULE_DISABLED');
    expect(res.text).toContain('scouting_players');
  });

  test('dashboard muestra solo los módulos activos del club', async () => {
    const context = await createTeamContext('Club Dashboard Active Modules');
    await setModuleEnabledForClub(context.club.id, 'planning', true);
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', true);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPI Scouting Players');
    expect(res.text).toContain('SPI Planning');
    expect(res.text).toContain('Abrir módulo');
    expect(res.text).toContain('/planning');
    expect(res.text).toContain('SPI Scouting Teams');
    expect(res.text).toContain('/scouting-teams');
    expect(res.text).toContain('Informes de rivales');
  });

  test('scoutingTeams bloquea el acceso cuando el módulo no está activo', async () => {
    const club = await createTestClub(`Club Scouting Teams Disabled ${Date.now()}`);
    const user = await createTestUser({
      name: 'Scouting Teams Disabled',
      role: 'admin',
      defaultClub: club.name,
    });
    await db.query(
      'UPDATE users SET club_id = ? WHERE id = ?',
      [club.id, user.id],
    );
    await setModuleEnabledForClub(club.id, 'scouting_teams', false);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: user.email, password: 'password123' });

    const res = await agent.get('/scouting-teams');
    expect(res.status).toBe(403);
    expect(res.text).toContain('MODULE_DISABLED');
    expect(res.text).toContain('scouting_teams');
  });

  test('scoutingTeams permite CRUD básico cuando el módulo está activo', async () => {
    const context = await createTeamContext('Club Scouting Teams CRUD');
    const ownTeamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ownTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Scouting Teams',
      ],
    );
    await db.query(
      'UPDATE users SET club_id = ? WHERE id = ?',
      [context.club.id, context.admin.id],
    );
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', true);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const resIndex = await agent.get('/scouting-teams');
    expect(resIndex.status).toBe(200);
    expect(resIndex.text).toContain('Scouting Teams');
    expect(resIndex.text).toContain('Nuevo informe');

    const resCreate = await agent.post('/scouting-teams').send({
      opponent_name: 'Real Opponent',
      opponent_country_name: 'España',
      own_team_id: ownTeamId,
      match_date: '2026-04-01',
      competition: 'División de Honor',
      system_shape: '4-4-2',
      style_in_possession: 'Ataque combinativo por dentro',
      style_out_of_possession: 'Bloque medio reactivo',
      transitions: 'Busca robo y salida rápida',
      set_pieces: 'Corners cerrados al primer palo',
      strengths: 'Laterales profundos',
      weaknesses: 'Espacio a la espalda',
      key_players: 'Mediocentro y extremo izquierdo',
      general_observations: 'Rival competitivo con buen ritmo inicial',
    });
    expect(resCreate.status).toBe(302);
    expect(resCreate.headers.location).toMatch(/^\/scouting-teams\//);

    const [reportRows] = await db.query(
      `SELECT r.id, r.competition, r.system_shape, o.name AS opponent_name
       FROM scouting_team_reports r
       INNER JOIN scouting_team_opponents o ON o.id = r.opponent_id
       WHERE r.club_id = ?
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [context.club.id],
    );
    expect(reportRows[0].opponent_name).toBe('Real Opponent');
    expect(reportRows[0].competition).toBe('División de Honor');
    expect(reportRows[0].system_shape).toBe('4-4-2');

    const reportId = reportRows[0].id;

    const resShow = await agent.get(`/scouting-teams/${reportId}`);
    expect(resShow.status).toBe(200);
    expect(resShow.text).toContain('Real Opponent');
    expect(resShow.text).toContain('Ataque combinativo por dentro');
    expect(resShow.text).toContain('Laterales profundos');
    expect(resShow.text).toContain('Borrar informe');

    const resUpdate = await agent.post(`/scouting-teams/${reportId}/update`).send({
      opponent_name: 'Real Opponent',
      opponent_country_name: 'España',
      own_team_id: ownTeamId,
      match_date: '2026-04-02',
      competition: 'Liga Nacional',
      system_shape: '4-3-3',
      style_in_possession: 'Salida por tres',
      style_out_of_possession: 'Presión alta intermitente',
      transitions: 'Amenaza tras recuperación en banda',
      set_pieces: 'Saques de esquina con bloqueos',
      strengths: 'Buen ritmo de circulación',
      weaknesses: 'Sufre en pérdidas interiores',
      key_players: 'Pivote y delantero',
      general_observations: 'Conviene atacar lado débil del lateral derecho',
    });
    expect(resUpdate.status).toBe(302);
    expect(resUpdate.headers.location).toBe(`/scouting-teams/${reportId}`);

    const [updatedRows] = await db.query(
      `SELECT competition, system_shape, general_observations
       FROM scouting_team_reports
       WHERE id = ?`,
      [reportId],
    );
    expect(updatedRows[0].competition).toBe('Liga Nacional');
    expect(updatedRows[0].system_shape).toBe('4-3-3');
    expect(updatedRows[0].general_observations).toContain('lateral derecho');

    const resDelete = await agent.post(`/scouting-teams/${reportId}/delete`);
    expect(resDelete.status).toBe(302);
    expect(resDelete.headers.location).toBe('/scouting-teams');

    const [deletedRows] = await db.query(
      'SELECT id FROM scouting_team_reports WHERE id = ?',
      [reportId],
    );
    expect(deletedRows).toHaveLength(0);
  });

  test('scoutingTeams permite a un usuario editar solo sus propios informes', async () => {
    const context = await createTeamContext('Club Scouting Teams Ownership');
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', true);

    const analyst = await createTestUser({
      name: 'Analyst Teams',
      email: `analyst-teams-${Date.now()}@test.local`,
      role: 'user',
      defaultClub: context.club.name,
    });
    const secondAnalyst = await createTestUser({
      name: 'Second Analyst Teams',
      email: `analyst-teams-second-${Date.now()}@test.local`,
      role: 'user',
      defaultClub: context.club.name,
    });

    await db.query('UPDATE users SET club_id = ? WHERE id IN (?, ?)', [
      context.club.id,
      analyst.id,
      secondAnalyst.id,
    ]);

    const analystAgent = request.agent(app);
    await analystAgent.post('/login').send({ email: analyst.email, password: 'password123' });

    const resNew = await analystAgent.get('/scouting-teams/new');
    expect(resNew.status).toBe(200);
    expect(resNew.text).toContain('Nuevo informe de scouting');

    const resCreate = await analystAgent.post('/scouting-teams').send({
      opponent_name: 'Owned Opponent',
      competition: 'Liga Nacional',
      strengths: 'Buen pie interior',
    });
    expect(resCreate.status).toBe(302);
    expect(resCreate.headers.location).toMatch(/^\/scouting-teams\//);

    const createdReportId = resCreate.headers.location.replace('/scouting-teams/', '');

    const resOwnedShow = await analystAgent.get(`/scouting-teams/${createdReportId}`);
    expect(resOwnedShow.status).toBe(200);
    expect(resOwnedShow.text).toContain('Editar');
    expect(resOwnedShow.text).not.toContain('Borrar informe');
    expect(resOwnedShow.text).toContain('el borrado queda reservado a administradores');

    const resOwnedEdit = await analystAgent.get(`/scouting-teams/${createdReportId}/edit`);
    expect(resOwnedEdit.status).toBe(200);
    expect(resOwnedEdit.text).toContain('Editar informe de scouting');

    const resOwnedUpdate = await analystAgent.post(`/scouting-teams/${createdReportId}/update`).send({
      opponent_name: 'Owned Opponent Updated',
      competition: 'Liga Nacional',
      strengths: 'Buen pie interior',
      weaknesses: 'Sufre a la espalda',
    });
    expect(resOwnedUpdate.status).toBe(302);
    expect(resOwnedUpdate.headers.location).toBe(`/scouting-teams/${createdReportId}`);

    const secondAgent = request.agent(app);
    await secondAgent.post('/login').send({ email: secondAnalyst.email, password: 'password123' });

    const resForbiddenEdit = await secondAgent.get(`/scouting-teams/${createdReportId}/edit`);
    expect(resForbiddenEdit.status).toBe(302);
    expect(resForbiddenEdit.headers.location).toBe(`/scouting-teams/${createdReportId}`);

    const resForbiddenDelete = await analystAgent.post(`/scouting-teams/${createdReportId}/delete`);
    expect(resForbiddenDelete.status).toBe(302);
    expect(resForbiddenDelete.headers.location).toBe(`/scouting-teams/${createdReportId}`);

    const [rows] = await db.query(
      'SELECT competition, weaknesses, created_by FROM scouting_team_reports WHERE id = ?',
      [createdReportId],
    );
    expect(rows[0].competition).toBe('Liga Nacional');
    expect(rows[0].weaknesses).toBe('Sufre a la espalda');
    expect(rows[0].created_by).toBe(analyst.id);
  });

  test('un admin ve acciones completas en la landing unificada de valoraciones', async () => {
    const { email } = await createTestUser({
      name: 'Valoraciones Admin',
      role: 'admin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const res = await agent.get('/assessments');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Valoraciones');
    expect(res.text).toContain('Crear informe');
    expect(res.text).toContain('Crear evaluacion');
    expect(res.text).toContain('Comparar jugadores');
  });

  test('un admin puede ver la página de gestión de jugadores', async () => {
    const context = await createTeamContext('Club Admin Players');
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
        'Juvenil Listado Foto',
      ],
    );
    await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, photo_path, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ['Foto', 'Listado', context.club.name, context.club.id, teamId, 'Juvenil Listado Foto', '/uploads/players/listado-test.png'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/admin/players');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Base de jugadores');
    expect(res.text).toContain('/uploads/players/listado-test.png');
  });

  test('un usuario normal con equipo activo puede acceder a la gestión acotada de sus jugadores', async () => {
    const context = await createEvaluationContext('User Scoped Players');
    const user = await createTestUser({
      name: 'User Players',
      role: 'user',
      defaultClub: context.club.name,
      defaultTeam: 'Juvenil Eval',
      defaultTeamId: context.teamId,
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: user.email, password: 'password123' });

    const res = await agent.get('/admin/players');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Base de jugadores');
    expect(res.text).toContain('Mario');
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

  test('superadmin creado desde administración no conserva club ni equipo aunque se envíen en el formulario', async () => {
    const context = await createEvaluationContext('Create Superadmin Global');
    const rootSuperadmin = await createTestUser({
      name: 'Root Superadmin Global Create',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: rootSuperadmin.email, password: 'password123' });

    const email = `global_superadmin_${Date.now()}@local`;
    const resPost = await agent.post('/admin/users').send({
      name: 'Nuevo Superadmin Global',
      email,
      password: 'password123',
      role: 'superadmin',
      club_id: String(context.club.id),
      default_team_id: context.teamId,
    });
    expect(resPost.status).toBe(302);

    const [rows] = await db.query(
      'SELECT role, club_id, default_club, default_team, default_team_id FROM users WHERE email = ?',
      [email],
    );
    expect(rows[0].role).toBe('superadmin');
    expect(rows[0].club_id).toBeNull();
    expect(rows[0].default_club).toBeNull();
    expect(rows[0].default_team).toBeNull();
    expect(rows[0].default_team_id).toBeNull();
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

  test('formulario de usuario no muestra fallback legacy de equipo por defecto', async () => {
    const club = await createTestClub(`Club User Legacy Hidden ${Date.now()}`);
    const superadmin = await createTestUser({
      name: 'Superadmin User Legacy Hidden',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const [userResult] = await db.query(
      `INSERT INTO users (
        name, email, password_hash, role, club_id, default_club, default_team, default_team_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'User Legacy Hidden',
        `user_legacy_hidden_${Date.now()}@local`,
        '$2b$10$dqViRKNFig.H8Ewz7IcQf.eiq..3sKjdfT9lsbHPq1xHSnzM6Sjsi',
        'user',
        club.id,
        club.name,
        'Equipo Legacy',
        null,
      ],
    );

    const res = await agent.get(`/admin/users/${userResult.insertId}/edit`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('(legacy)');
    expect(res.text).toContain('El equipo por defecto debe salir de Plantillas v2 del club asignado.');
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

  test('editar un superadmin limpia cualquier club o equipo enviado desde administración', async () => {
    const context = await createEvaluationContext('Edit Superadmin Global');
    const rootSuperadmin = await createTestUser({
      name: 'Root Superadmin Global Edit',
      role: 'superadmin',
    });
    const targetSuperadmin = await createTestUser({
      name: 'Target Superadmin With Legacy',
      role: 'superadmin',
    });
    await db.query(
      'UPDATE users SET club_id = ?, default_club = ?, default_team = ?, default_team_id = ? WHERE id = ?',
      [context.club.id, context.club.name, 'Juvenil Eval', context.teamId, targetSuperadmin.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: rootSuperadmin.email, password: 'password123' });

    const resPost = await agent.post(`/admin/users/${targetSuperadmin.id}/edit`).send({
      name: 'Target Superadmin With Legacy',
      email: targetSuperadmin.email,
      club_id: String(context.club.id),
      default_club: context.club.name,
      default_team_id: context.teamId,
      new_password: '',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query(
      'SELECT role, club_id, default_club, default_team, default_team_id FROM users WHERE id = ?',
      [targetSuperadmin.id],
    );
    expect(rows[0].role).toBe('superadmin');
    expect(rows[0].club_id).toBeNull();
    expect(rows[0].default_club).toBeNull();
    expect(rows[0].default_team).toBeNull();
    expect(rows[0].default_team_id).toBeNull();
  });

  test('promocionar un usuario a superadmin limpia su contexto de club y equipo', async () => {
    const context = await createEvaluationContext('Promote Superadmin Global');
    const rootSuperadmin = await createTestUser({
      name: 'Root Superadmin Promote',
      role: 'superadmin',
    });
    const targetUser = await createTestUser({
      name: 'Target Promote Superadmin',
      role: 'user',
      defaultClub: context.club.name,
      defaultTeam: 'Juvenil Eval',
      defaultTeamId: context.teamId,
    });
    await db.query('UPDATE users SET club_id = ? WHERE id = ?', [context.club.id, targetUser.id]);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: rootSuperadmin.email, password: 'password123' });

    const resPost = await agent.post(`/admin/users/${targetUser.id}/role`).send({
      role: 'superadmin',
    });
    expect(resPost.status).toBe(302);
    expect(resPost.headers.location).toBe('/admin/users');

    const [rows] = await db.query(
      'SELECT role, club_id, default_club, default_team, default_team_id FROM users WHERE id = ?',
      [targetUser.id],
    );
    expect(rows[0].role).toBe('superadmin');
    expect(rows[0].club_id).toBeNull();
    expect(rows[0].default_club).toBeNull();
    expect(rows[0].default_team).toBeNull();
    expect(rows[0].default_team_id).toBeNull();
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

  test('un admin no puede promocionar a otro usuario a admin', async () => {
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
    expect(rows[0].role).toBe('user');
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
    const admin = await createTestUser({
      name: 'Admin Report API',
      role: 'admin',
    });
    const agent = request.agent(app);
    await agent.post('/login').send({ email: admin.email, password: 'password123' });
    const res = await agent.get('/reports/api/999999');
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

  test('un superadmin puede abrir configuración de club sin club por defecto y seleccionar uno explícitamente', async () => {
    const club = await createTestClub(`Club Superadmin Config ${Date.now()}`);
    const { email } = await createTestUser({
      name: 'Superadmin Config Global',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email, password: 'password123' });

    const resSelector = await agent.get('/admin/club');
    expect(resSelector.status).toBe(200);
    expect(resSelector.text).toContain('Configuración del club: Selecciona un club');
    expect(resSelector.text).toContain('Selecciona primero un club para administrar su configuración');

    const resClub = await agent.get(`/admin/club?club_id=${club.id}`);
    expect(resClub.status).toBe(200);
    expect(resClub.text).toContain(`Configuración del club: ${club.name}`);
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
    const context = await createTeamContext('Club Equipos');
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
        'Equipo A',
      ],
    );

    const agent = request.agent(app);
    await agent
      .post('/login')
      .send({ email: context.admin.email, password: 'password123' });

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
    expect(players[0].first_name).toBe('Mario');
    expect(players[0].last_name).toBe('Garcia Lopez');
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

  test('conserva apellidos completos cuando ProcessIQ devuelve shortName y fullName sin coma', async () => {
    const context = await createTeamContext('Club Teams ProcessIQ Full Surname');
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
        'ext-team-full-surname',
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
        json: async () => ({ accessToken: 'token-full-surname' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ext-team-full-surname',
              name: 'Infantil API',
              players: [
                {
                  id: 'player-full-surname-1',
                  shortName: 'PEDRO',
                  fullName: 'Pedro Lafuente Ayllon',
                  dorsal: '13',
                  positions: 'POR',
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
            id: 'player-full-surname-1',
            shortName: 'PEDRO',
            fullName: 'Pedro Lafuente Ayllon',
            fields: {
              fecha_nacimiento: '20/02/2012',
              lateralidad: 'Derecho',
              nacionalidad: 'ESPAÑOLA',
              teléfonos: '645977771',
              posiciones: 'Portero',
            },
          },
        }),
      });

    const res = await agent.post(`/teams/${teamId}/import-players/processiq`).send();
    global.fetch = originalFetch;

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/teams/${teamId}`);

    const [players] = await db.query(
      `SELECT first_name, last_name, external_id
       FROM players
       WHERE club_id = ? AND external_id = ?`,
      [context.club.id, 'player-full-surname-1'],
    );
    expect(players).toHaveLength(1);
    expect(players[0].first_name).toBe('Pedro');
    expect(players[0].last_name).toBe('Lafuente Ayllon');
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

  test('el listado de plantillas muestra un resumen de plantilla en lugar del listado de jugadores', async () => {
    const context = await createTeamContext('Club Teams Summary Card');
    const teamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.infantil.id,
        'Infantil Resumen',
      ],
    );

    const [playerAResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, birth_year, laterality, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ['Iker', 'Zurdo', context.club.name, context.club.id, teamId, 'Infantil Resumen', 2013, 'IZQ'],
    );
    const [playerBResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, birth_year, laterality, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ['Mario', 'Diestro', context.club.name, context.club.id, teamId, 'Infantil Resumen', 2013, 'DER'],
    );

    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        teamId,
        playerAResult.insertId,
        '3',
        'LI',
        randomUUID(),
        teamId,
        playerBResult.insertId,
        '8',
        'MC',
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get('/teams?section=Masculina&category=Infantil');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Año base');
    expect(res.text).toContain('Cobertura');
    expect(res.text).toContain('Lateralidad');
    expect(res.text).toContain('Diestros');
    expect(res.text).not.toContain('Iker Zurdo');
    expect(res.text).not.toContain('Mario Diestro');
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

  test('club config muestra solo equipos v2 del club', async () => {
    const context = await createTeamContext('Club Config Compat');
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
    expect(res.text).not.toContain('Compatibilidad legacy');
  });

  test('un admin puede actualizar el branding de su club', async () => {
    const context = await createTeamContext('Club Branding');
    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent
      .post('/admin/club/branding')
      .field('club_id', String(context.club.id))
      .field('interface_color', '#123ABC')
      .attach('crest_file', Buffer.from('fake-png-content'), 'crest.png');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/admin/club?club_id=${context.club.id}`);

    const [rows] = await db.query(
      'SELECT interface_color, crest_path FROM clubs WHERE id = ?',
      [context.club.id],
    );
    expect(rows[0].interface_color).toBe('#123ABC');
    expect(rows[0].crest_path).toContain('/uploads/clubs/');
  });

  test('un admin puede gestionar los módulos activos de su club desde configuración', async () => {
    const context = await createTeamContext('Club Module Admin');
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', false);
    await setModuleEnabledForClub(context.club.id, 'planning', false);

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const resConfig = await agent.get('/admin/club');
    expect(resConfig.status).toBe(200);
    expect(resConfig.text).toContain('Módulos activos del club');
    expect(resConfig.text).toContain('Presets rápidos');
    expect(resConfig.text).toContain('Core operativo');
    expect(resConfig.text).toContain('Análisis deportivo');
    expect(resConfig.text).toContain('Scouting Players');
    expect(resConfig.text).toContain('Scouting Teams');
    expect(resConfig.text).toContain('Usuarios del club pueden crear y editar sus propios informes');

    const resUpdate = await agent.post('/admin/club/modules').send({
      club_id: String(context.club.id),
      module_keys: ['scouting_players', 'scouting_teams'],
    });
    expect(resUpdate.status).toBe(302);
    expect(resUpdate.headers.location).toBe(`/admin/club?club_id=${context.club.id}`);

    const [rows] = await db.query(
      'SELECT module_key, enabled FROM club_modules WHERE club_id = ? ORDER BY module_key ASC',
      [context.club.id],
    );
    expect(rows.find((row) => row.module_key === 'scouting_players').enabled).toBe(1);
    expect(rows.find((row) => row.module_key === 'scouting_teams').enabled).toBe(1);
    expect(rows.find((row) => row.module_key === 'planning').enabled).toBe(0);

    const resDashboard = await agent.get('/dashboard');
    expect(resDashboard.status).toBe(200);
    expect(resDashboard.text).toContain('/scouting-teams');
    expect(resDashboard.text).toContain('Scouting Teams');

    const resPreset = await agent.post('/admin/club/modules').send({
      club_id: String(context.club.id),
      module_preset: 'full_suite',
    });
    expect(resPreset.status).toBe(302);
    expect(resPreset.headers.location).toBe(`/admin/club?club_id=${context.club.id}`);

    const [rowsAfterPreset] = await db.query(
      'SELECT module_key, enabled FROM club_modules WHERE club_id = ? ORDER BY module_key ASC',
      [context.club.id],
    );
    expect(rowsAfterPreset.every((row) => row.enabled === 1)).toBe(true);
  });

  test('la configuración de club permite definir un override de modo de producto', async () => {
    const context = await createTeamContext('Club Product Mode Override');

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const resConfig = await agent.get('/admin/club');
    expect(resConfig.status).toBe(200);
    expect(resConfig.text).toContain('Modo de producto del club');
    expect(resConfig.text).toContain('Heredar modo global');

    const resUpdate = await agent.post('/admin/club/product-mode').send({
      club_id: String(context.club.id),
      product_mode: 'pmv_player_tracking',
    });
    expect(resUpdate.status).toBe(302);
    expect(resUpdate.headers.location).toBe(`/admin/club?club_id=${context.club.id}`);

    const [[clubRow]] = await db.query(
      'SELECT product_mode FROM clubs WHERE id = ?',
      [context.club.id],
    );
    expect(clubRow.product_mode).toBe('pmv_player_tracking');
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

  test('superadmin puede operar plantillas de un club seleccionado mediante club_id', async () => {
    const context = await createTeamContext('Club Superadmin Teams');
    const superadmin = await createTestUser({
      name: 'Superadmin Teams',
      role: 'superadmin',
    });

    const agent = request.agent(app);
    await agent.post('/login').send({ email: superadmin.email, password: 'password123' });

    const resIndex = await agent.get(`/teams?club_id=${context.club.id}`);
    expect(resIndex.status).toBe(200);
    expect(resIndex.text).toContain(context.club.name);
    expect(resIndex.text).toContain(`/teams/new?club_id=${context.club.id}`);

    const resForm = await agent.get(`/teams/new?club_id=${context.club.id}`);
    expect(resForm.status).toBe(200);
    expect(resForm.text).toContain('Nueva plantilla');
    expect(resForm.text).toContain(`name="club_id" value="${context.club.id}"`);
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
    expect(res.text).toContain('SoccerProcessIQ Suite');
    expect(res.text).toContain('SPI Core');
    expect(res.text).toContain('Lucia Pardo');
    expect(res.text).toContain('Perfil');
    expect(res.text).toContain('SPI Scouting Players');
    expect(res.text).not.toContain('SPI Planning');
    expect(res.text).toContain('roster-filter-year');
    expect(res.text).toContain('roster-filter-position');
    expect(res.text).toContain('roster-filter-laterality');
  });

  test('team detail muestra módulos activos del club en el contexto del equipo', async () => {
    const context = await createTeamContext('Club Team Workspace Modules');
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
        'Juvenil Workspace',
      ],
    );
    await setModuleEnabledForClub(context.club.id, 'planning', true);
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/teams/${teamId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPI Scouting Players');
    expect(res.text).toContain('SPI Planning');
    expect(res.text).toContain('SPI Scouting Teams');
    expect(res.text).toContain(`/planning?team_id=${teamId}`);
    expect(res.text).toContain(`/scouting-teams?team_id=${teamId}`);
  });

  test('dashboard en modo pmv_player_tracking prioriza player tracking y oculta planning y scouting teams', async () => {
    const context = await createTeamContext('Club Dashboard PMV');
    await setModuleEnabledForClub(context.club.id, 'planning', true);
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', true);
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('¿Qué quieres hacer ahora?');
    expect(res.text).toContain('Entrar por equipo');
    expect(res.text).toContain('Evaluar jugador');
    expect(res.text).toContain('Ver historial de informes');
    expect(res.text).toContain('Actividad reciente');
    expect(res.text).not.toContain('Estado de la suite');
    expect(res.text).not.toContain('Capacidades visibles');
    expect(res.text).not.toContain('SPI Core');
    expect(res.text).not.toContain('PMV vendible');
    expect(res.text).not.toContain('SPI Planning');
    expect(res.text).not.toContain('SPI Scouting Teams');
  });

  test('team detail en modo pmv_player_tracking oculta planning y scouting teams de la UI principal', async () => {
    const context = await createTeamContext('Club Team PMV');
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
        'Juvenil PMV',
      ],
    );
    await setModuleEnabledForClub(context.club.id, 'planning', true);
    await setModuleEnabledForClub(context.club.id, 'scouting_teams', true);
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/teams/${teamId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPI Player Tracking');
    expect(res.text).toContain('Accesos rápidos');
    expect(res.text).toContain(`/evaluations/new?team_id=${teamId}`);
    expect(res.text).toContain(`/reports/new?team_id=${teamId}`);
    expect(res.text).not.toContain('SPI Planning');
    expect(res.text).not.toContain('SPI Scouting Teams');
  });

  test('team detail en pmv muestra estado actual del equipo cuando hay base suficiente', async () => {
    const context = await createEvaluationContext('Club Team Benchmark PMV');
    await seedTeamBenchmarkFixture(context);
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/teams/${context.teamId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Estado actual del equipo');
    expect(res.text).toContain('Jugadores evaluados');
    expect(res.text).toContain('Evaluaciones usadas');
    expect(res.text).toContain('Media global');
    expect(res.text).toContain('Por encima de la media');
    expect(res.text).toContain('Con margen de mejora');
  });

  test('team detail en pmv oculta benchmark si no hay mínimo de jugadores evaluados', async () => {
    const context = await createEvaluationContext('Club Team Benchmark Empty');
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
        '2026-03-12',
        'manual',
        'Base insuficiente',
        'Notas',
        7.1,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationId);
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/teams/${context.teamId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Estado actual del equipo');
    expect(res.text).toContain('Aún no hay suficientes evaluaciones para mostrar una visión útil del equipo.');
  });

  test('planning bloquea el acceso cuando el módulo no está activo', async () => {
    const context = await createTeamContext('Club Planning Disabled');
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
        'Juvenil Planning Off',
      ],
    );
    await setModuleEnabledForClub(context.club.id, 'planning', false);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/planning?team_id=${teamId}`);
    expect(res.status).toBe(403);
    expect(res.text).toContain('MODULE_DISABLED');
    expect(res.text).toContain('planning');
  });

  test('planning permite CRUD básico de planificación, microciclos y sesiones', async () => {
    const context = await createTeamContext('Club Planning CRUD');
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
        'Juvenil Planning',
      ],
    );
    await setModuleEnabledForClub(context.club.id, 'planning', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const resHome = await agent.get(`/planning?team_id=${teamId}`);
    expect(resHome.status).toBe(200);
    expect(resHome.text).toContain('SPI Planning');
    expect(resHome.text).toContain('Juvenil Planning');

    const resCreatePlan = await agent.post('/planning/plans').send({
      team_id: teamId,
      season_label: '2026/2027',
      planning_model: 'structured_microcycle',
      start_date: '2026-07-15',
      end_date: '2027-06-15',
      objective: 'Desarrollo del modelo de juego',
      notes: 'Plan inicial',
    });
    expect(resCreatePlan.status).toBe(302);
    expect(resCreatePlan.headers.location).toMatch(/^\/planning\/plans\//);

    const [planRows] = await db.query(
      'SELECT id, team_id, season_label FROM season_plans WHERE club_id = ? AND team_id = ?',
      [context.club.id, teamId],
    );
    expect(planRows).toHaveLength(1);
    expect(planRows[0].season_label).toBe('2026/2027');

    const seasonPlanId = planRows[0].id;
    const resPlanShow = await agent.get(`/planning/plans/${seasonPlanId}`);
    expect(resPlanShow.status).toBe(200);
    expect(resPlanShow.text).toContain('Microciclos');

    const resCreateMicrocycle = await agent.post('/planning/microcycles').send({
      season_plan_id: seasonPlanId,
      name: 'Microciclo 1',
      order_index: '1',
      start_date: '2026-07-15',
      end_date: '2026-07-21',
      objective: 'Base condicional',
      phase: 'Acumulacion',
      notes: 'Semana 1',
    });
    expect(resCreateMicrocycle.status).toBe(302);
    expect(resCreateMicrocycle.headers.location).toMatch(/^\/planning\/microcycles\//);

    const [microcycleRows] = await db.query(
      'SELECT id, name FROM plan_microcycles WHERE season_plan_id = ?',
      [seasonPlanId],
    );
    expect(microcycleRows).toHaveLength(1);
    expect(microcycleRows[0].name).toBe('Microciclo 1');

    const microcycleId = microcycleRows[0].id;
    const resCreateSession = await agent.post('/planning/sessions').send({
      microcycle_id: microcycleId,
      session_date: '2026-07-16',
      title: 'Sesion MD-4',
      session_type: 'Entrenamiento de campo',
      duration_minutes: '90',
      status: 'planned',
      objective: 'Principios ofensivos',
      contents: 'Rondo, juego de posicion',
      notes: 'Carga media',
    });
    expect(resCreateSession.status).toBe(302);
    expect(resCreateSession.headers.location).toBe(`/planning/microcycles/${microcycleId}`);

    const [sessionRows] = await db.query(
      'SELECT id, title, duration_minutes, status FROM plan_sessions WHERE microcycle_id = ?',
      [microcycleId],
    );
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].title).toBe('Sesion MD-4');
    expect(sessionRows[0].duration_minutes).toBe(90);
    expect(sessionRows[0].status).toBe('planned');

    const sessionId = sessionRows[0].id;
    const resCreateTask = await agent.post('/planning/tasks')
      .field('session_id', sessionId)
      .field('sort_order', '1')
      .field('title', 'Rondo de activacion')
      .field('task_type', 'Activacion')
      .field('duration_minutes', '15')
      .field('objective', 'Preparar para la parte principal')
      .field('details', '3x1 con apoyo exterior y normas de orientacion')
      .field('space', '20x20')
      .field('age_group', 'Sub-19')
      .field('player_count', '8')
      .field('complexity', 'Media')
      .field('strategy', 'Grupal')
      .field('coordinative_skills', 'Orientacion')
      .field('tactical_intention', 'Conservar')
      .field('dynamics', 'Integrada')
      .field('game_situation', 'Con oposicion')
      .field('coordination', 'Especifica')
      .field('contents', '3x1 en espacio reducido')
      .field('notes', 'Alta implicacion')
      .attach('explanatory_image_file', Buffer.from('fake-png-content'), {
        filename: 'task-test.png',
        contentType: 'image/png',
      });
    expect(resCreateTask.status).toBe(302);
    expect(resCreateTask.headers.location).toBe(`/planning/sessions/${sessionId}`);

    const [taskRows] = await db.query(
      `SELECT id, title, duration_minutes, player_count, complexity, strategy,
              explanatory_image_path, details
       FROM plan_session_tasks WHERE session_id = ?`,
      [sessionId],
    );
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].title).toBe('Rondo de activacion');
    expect(taskRows[0].duration_minutes).toBe(15);
    expect(taskRows[0].player_count).toBe(8);
    expect(taskRows[0].complexity).toBe('Media');
    expect(taskRows[0].strategy).toBe('Grupal');
    expect(taskRows[0].details).toContain('3x1');
    expect(taskRows[0].explanatory_image_path).toContain('/uploads/planning/');

    const taskId = taskRows[0].id;
    const resUpdateTask = await agent.post(`/planning/tasks/${taskId}/update`).send({
      session_id: sessionId,
      sort_order: '1',
      title: 'Rondo de activacion',
      task_type: 'Activacion',
      duration_minutes: '20',
      objective: 'Preparar para la parte principal',
      details: '3x1 con una serie adicional y cambio de roles',
      space: '25x25',
      age_group: 'Sub-19',
      player_count: '10',
      complexity: 'Alta',
      strategy: 'Colectiva',
      coordinative_skills: 'Reaccion',
      tactical_intention: 'Progresar',
      dynamics: 'Competitiva',
      game_situation: 'Superioridad',
      coordination: 'Neuromuscular',
      explanatory_image_path: taskRows[0].explanatory_image_path,
      contents: '3x1 en espacio reducido',
      notes: 'Carga ajustada',
    });
    expect(resUpdateTask.status).toBe(302);
    expect(resUpdateTask.headers.location).toBe(`/planning/sessions/${sessionId}`);

    const [updatedTaskRows] = await db.query(
      `SELECT duration_minutes, notes, player_count, complexity, strategy, explanatory_image_path
       FROM plan_session_tasks WHERE id = ?`,
      [taskId],
    );
    expect(updatedTaskRows[0].duration_minutes).toBe(20);
    expect(updatedTaskRows[0].notes).toBe('Carga ajustada');
    expect(updatedTaskRows[0].player_count).toBe(10);
    expect(updatedTaskRows[0].complexity).toBe('Alta');
    expect(updatedTaskRows[0].strategy).toBe('Colectiva');
    expect(updatedTaskRows[0].explanatory_image_path).toContain('/uploads/planning/');

    const resUpdateSession = await agent.post(`/planning/sessions/${sessionId}/update`).send({
      microcycle_id: microcycleId,
      session_date: '2026-07-16',
      title: 'Sesion MD-4',
      session_type: 'Entrenamiento de campo',
      duration_minutes: '90',
      status: 'done',
      objective: 'Principios ofensivos',
      contents: 'Rondo, juego de posicion',
      notes: 'Carga completada',
    });
    expect(resUpdateSession.status).toBe(302);

    const [updatedSessionRows] = await db.query(
      'SELECT status, notes FROM plan_sessions WHERE id = ?',
      [sessionId],
    );
    expect(updatedSessionRows[0].status).toBe('done');
    expect(updatedSessionRows[0].notes).toBe('Carga completada');

    const resCreateTemplate = await agent.post('/planning/templates').send({
      source_microcycle_id: microcycleId,
      name: 'Plantilla competitiva',
      phase: 'Competicion',
      objective: 'Base competitiva',
      notes: 'Plantilla reusable',
    });
    expect(resCreateTemplate.status).toBe(302);
    expect(resCreateTemplate.headers.location).toBe(`/planning/plans/${seasonPlanId}`);

    const [templateRows] = await db.query(
      'SELECT id, name FROM planning_microcycle_templates WHERE club_id = ? AND team_id = ?',
      [context.club.id, teamId],
    );
    expect(templateRows).toHaveLength(1);
    expect(templateRows[0].name).toBe('Plantilla competitiva');

    const templateId = templateRows[0].id;
    const [templateSessionRows] = await db.query(
      'SELECT day_offset, title, status FROM planning_microcycle_template_sessions WHERE template_id = ? ORDER BY sort_order ASC',
      [templateId],
    );
    expect(templateSessionRows).toHaveLength(1);
    expect(templateSessionRows[0].day_offset).toBe(1);
    expect(templateSessionRows[0].status).toBe('done');

    const [templateTaskRows] = await db.query(
      `SELECT pmtsst.title, pmtsst.explanatory_image_path
       FROM planning_microcycle_template_session_tasks pmtsst
       INNER JOIN planning_microcycle_template_sessions pmts ON pmts.id = pmtsst.template_session_id
       WHERE pmts.template_id = ?`,
      [templateId],
    );
    expect(templateTaskRows).toHaveLength(1);
    expect(templateTaskRows[0].title).toBe('Rondo de activacion');
    expect(templateTaskRows[0].explanatory_image_path).toContain('/uploads/planning/');

    const resCreateFromTemplate = await agent.post('/planning/microcycles').send({
      season_plan_id: seasonPlanId,
      template_id: templateId,
      name: '',
      order_index: '2',
      start_date: '2026-08-01',
      end_date: '2026-08-07',
      objective: '',
      phase: '',
      notes: '',
    });
    expect(resCreateFromTemplate.status).toBe(302);
    expect(resCreateFromTemplate.headers.location).toMatch(/^\/planning\/microcycles\//);

    const [templatedMicrocycleRows] = await db.query(
      'SELECT id, name FROM plan_microcycles WHERE season_plan_id = ? ORDER BY order_index ASC',
      [seasonPlanId],
    );
    expect(templatedMicrocycleRows).toHaveLength(2);
    expect(templatedMicrocycleRows[1].name).toBe('Plantilla competitiva');

    const templatedMicrocycleId = templatedMicrocycleRows[1].id;
    const [templatedSessionRows] = await db.query(
      'SELECT id, session_date, status FROM plan_sessions WHERE microcycle_id = ?',
      [templatedMicrocycleId],
    );
    expect(templatedSessionRows).toHaveLength(1);
    expect(formatMysqlDate(templatedSessionRows[0].session_date)).toBe('2026-08-02');
    expect(templatedSessionRows[0].status).toBe('done');

    const [templatedTaskRows] = await db.query(
      'SELECT title, explanatory_image_path FROM plan_session_tasks WHERE session_id = ?',
      [templatedSessionRows[0].id],
    );
    expect(templatedTaskRows).toHaveLength(1);
    expect(templatedTaskRows[0].title).toBe('Rondo de activacion');
    expect(templatedTaskRows[0].explanatory_image_path).toContain('/uploads/planning/');

    const resDuplicateMicrocycle = await agent.post(`/planning/microcycles/${microcycleId}/duplicate`);
    expect(resDuplicateMicrocycle.status).toBe(302);
    expect(resDuplicateMicrocycle.headers.location).toMatch(/^\/planning\/microcycles\//);

    const [duplicatedMicrocycleRows] = await db.query(
      'SELECT id, name, order_index FROM plan_microcycles WHERE season_plan_id = ? ORDER BY order_index ASC',
      [seasonPlanId],
    );
    expect(duplicatedMicrocycleRows).toHaveLength(3);
    expect(duplicatedMicrocycleRows[2].name).toContain('(copia)');

    const duplicatedMicrocycleId = duplicatedMicrocycleRows[2].id;
    const [duplicatedSessionRows] = await db.query(
      'SELECT id, title, status FROM plan_sessions WHERE microcycle_id = ?',
      [duplicatedMicrocycleId],
    );
    expect(duplicatedSessionRows).toHaveLength(1);
    expect(duplicatedSessionRows[0].title).toBe('Sesion MD-4');
    expect(duplicatedSessionRows[0].status).toBe('done');

    const [duplicatedTaskRows] = await db.query(
      'SELECT title, explanatory_image_path FROM plan_session_tasks WHERE session_id = ?',
      [duplicatedSessionRows[0].id],
    );
    expect(duplicatedTaskRows).toHaveLength(1);
    expect(duplicatedTaskRows[0].title).toBe('Rondo de activacion');
    expect(duplicatedTaskRows[0].explanatory_image_path).toContain('/uploads/planning/');

    const resMicrocycleShow = await agent.get(`/planning/microcycles/${microcycleId}`);
    expect(resMicrocycleShow.status).toBe(200);
    expect(resMicrocycleShow.text).toContain('Sesion MD-4');
    expect(resMicrocycleShow.text).toContain('Entrenamiento de campo');
    expect(resMicrocycleShow.text).toContain('Vista semanal');
    expect(resMicrocycleShow.text).toContain('Realizada');
    expect(resMicrocycleShow.text).toContain('Abrir');

    const resSessionShow = await agent.get(`/planning/sessions/${sessionId}`);
    expect(resSessionShow.status).toBe(200);
    expect(resSessionShow.text).toContain('Rondo de activacion');
    expect(resSessionShow.text).toContain('Tareas');
    expect(resSessionShow.text).toContain('25x25');
    expect(resSessionShow.text).toContain('/uploads/planning/');
  });

  test('planning aísla planificaciones de equipos fuera del alcance del usuario', async () => {
    const context = await createTeamContext('Club Planning Scope');
    const visibleTeamId = randomUUID();
    const hiddenTeamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        visibleTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Visible Planning',
        hiddenTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.cadete.id,
        'Cadete Hidden Planning',
      ],
    );
    await setModuleEnabledForClub(context.club.id, 'planning', true);
    await db.query(
      `INSERT INTO season_plans (
        id, club_id, team_id, season_label, planning_model, start_date, end_date, objective, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        context.club.id,
        hiddenTeamId,
        '2026/2027',
        'structured_microcycle',
        '2026-07-01',
        '2027-06-01',
        'Plan oculto',
        context.admin.id,
      ],
    );

    const scopedUser = await createTestUser({
      name: 'Planning Scoped User',
      role: 'user',
      defaultClub: context.club.name,
      defaultTeamId: visibleTeamId,
      defaultTeam: 'Juvenil Visible Planning',
    });
    await db.query(
      'UPDATE users SET club_id = ? WHERE id = ?',
      [context.club.id, scopedUser.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: scopedUser.email,
      password: 'password123',
    });

    const res = await agent.get('/planning');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Juvenil Visible Planning');
    expect(res.text).not.toContain('Cadete Hidden Planning');
    expect(res.text).not.toContain('Plan oculto');
  });

  test('usuario normal solo ve su equipo activo en plantillas', async () => {
    const context = await createTeamContext('Club Scoped Teams');
    const visibleTeamId = randomUUID();
    const hiddenTeamId = randomUUID();

    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        visibleTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.juvenil.id,
        'Juvenil Visible',
        hiddenTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.cadete.id,
        'Cadete Oculto',
      ],
    );

    const user = await createTestUser({
      name: 'Scoped Team User',
      role: 'user',
      defaultClub: context.club.name,
      defaultTeam: 'Juvenil Visible',
      defaultTeamId: visibleTeamId,
    });

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: user.email,
      password: 'password123',
    });

    const res = await agent.get('/teams');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Juvenil Visible');
    expect(res.text).not.toContain('Cadete Oculto');
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

  test('evaluation form muestra solo jugadores del equipo seleccionado', async () => {
    const context = await createEvaluationContext('Club Eval Filter Team');
    const otherTeamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        otherTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.cadete.id,
        'Cadete Filtro',
      ],
    );
    const [otherPlayerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ['Pepe', 'Ajeno', context.club.name, context.club.id, otherTeamId, 'Cadete Filtro'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), otherTeamId, otherPlayerResult.insertId, '4', 'CENTRAL'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/evaluations/new?team_id=${context.teamId}`);
    expect(res.status).toBe(200);

    const playerSelectMatch = res.text.match(/<select id="player_id"[\s\S]*?>([\s\S]*?)<\/select>/);
    expect(playerSelectMatch).toBeTruthy();
    expect(playerSelectMatch[1]).toContain('Mario Sanz');
    expect(playerSelectMatch[1]).not.toContain('Pepe Ajeno');
  });

  test('evaluation form muestra todos los jugadores si no hay equipo seleccionado', async () => {
    const context = await createEvaluationContext('Club Eval Filter All');
    const otherTeamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        otherTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.cadete.id,
        'Cadete Todos',
      ],
    );
    const [otherPlayerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ['Pepe', 'Ajeno', context.club.name, context.club.id, otherTeamId, 'Cadete Todos'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), otherTeamId, otherPlayerResult.insertId, '5', 'MC'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get('/evaluations/new');
    expect(res.status).toBe(200);

    const playerSelectMatch = res.text.match(/<select id="player_id"[\s\S]*?>([\s\S]*?)<\/select>/);
    expect(playerSelectMatch).toBeTruthy();
    expect(playerSelectMatch[1]).toContain('Mario Sanz');
    expect(playerSelectMatch[1]).toContain('Pepe Ajeno');
  });

  test('usuario normal puede crear evaluaciones solo para su equipo activo', async () => {
    const context = await createEvaluationContext('Club User Eval');
    const otherTeamId = randomUUID();
    await db.query(
      `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        otherTeamId,
        context.club.id,
        context.season.id,
        context.masculina.id,
        context.cadete.id,
        'Cadete Ajeno',
      ],
    );
    const [otherPlayerResult] = await db.query(
      `INSERT INTO players (
        first_name, last_name, club, club_id, current_team_id, team, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ['Pepe', 'Ajeno', context.club.name, context.club.id, otherTeamId, 'Cadete Ajeno'],
    );
    await db.query(
      `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), otherTeamId, otherPlayerResult.insertId, '4', 'CENTRAL'],
    );

    const user = await createTestUser({
      name: 'Scoped Eval User',
      role: 'user',
      defaultClub: context.club.name,
      defaultTeam: 'Juvenil Eval',
      defaultTeamId: context.teamId,
    });

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: user.email,
      password: 'password123',
    });

    const okRes = await agent.post('/evaluations').send(buildEvaluationPayload({
      season_id: context.season.id,
      team_id: context.teamId,
      player_id: context.playerId,
    }));
    expect(okRes.status).toBe(302);
    expect(okRes.headers.location).toMatch(/^\/evaluations\//);

    const forbiddenRes = await agent.post('/evaluations').send(buildEvaluationPayload({
      season_id: context.season.id,
      team_id: otherTeamId,
      player_id: otherPlayerResult.insertId,
      title: 'Intento fuera de alcance',
    }));
    expect(forbiddenRes.status).toBe(422);
    expect(forbiddenRes.text).toContain('No tienes permisos sobre el equipo seleccionado');
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
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['suite', context.club.id],
    );
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
    expect(res.text).toContain(`/evaluations/new?team_id=${context.teamId}&player_id=${context.playerId}`);
    expect(res.text).toContain(`/reports/new?team_id=${context.teamId}&player_id=${context.playerId}`);
  });

  test('reports new precontextualiza el jugador en flujo pmv', async () => {
    const context = await createEvaluationContext('Club Report Flow');
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/reports/new?team_id=${context.teamId}&player_id=${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPI Player Tracking');
    expect(res.text).toContain('Estás creando un informe para <strong>Mario Sanz</strong>');
    expect(res.text).toContain(`name="player_id" value="${context.playerId}"`);
  });

  test('player profile muestra la foto del jugador cuando existe', async () => {
    const context = await createTeamContext('Club Player Photo');
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
        'Juvenil Foto',
      ],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const createRes = await agent
      .post('/admin/players/new')
      .field('first_name', 'Lucas')
      .field('last_name', 'Foto')
      .field('club', context.club.name)
      .field('team_id', teamId)
      .field('dorsal', '11')
      .field('positions', 'ED')
      .attach('photo_file', Buffer.from('fake-image-content'), 'player.png');

    expect(createRes.status).toBe(302);
    expect(createRes.headers.location).toBe('/admin/players');

    const [rows] = await db.query(
      'SELECT id, photo_path FROM players WHERE club_id = ? AND first_name = ? AND last_name = ?',
      [context.club.id, 'Lucas', 'Foto'],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].photo_path).toContain('/uploads/players/');

    const profileRes = await agent.get(`/players/${rows[0].id}`);
    expect(profileRes.status).toBe(200);
    expect(profileRes.text).toContain(`src="${rows[0].photo_path}"`);
    expect(profileRes.text).toContain('Foto de Lucas Foto');
  });

  test('player profile with evaluations renders analytics and chart', async () => {
    const context = await createEvaluationContext('Club Perfil Eval');
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['suite', context.club.id],
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

  test('player profile en modo pmv prioriza resumen, evolución e histórico', async () => {
    const context = await createEvaluationContext('Club Perfil PMV');
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );

    const firstEvaluationId = randomUUID();
    const secondEvaluationId = randomUUID();
    await db.query(
      `INSERT INTO evaluations (
        id, club_id, season_id, team_id, player_id, author_id, evaluation_date,
        source, title, notes, overall_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstEvaluationId,
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-03-02',
        'manual',
        'Seguimiento febrero',
        'Notas 1',
        6.8,
        secondEvaluationId,
        context.club.id,
        context.season.id,
        context.teamId,
        context.playerId,
        context.admin.id,
        '2026-03-18',
        'manual',
        'Seguimiento marzo',
        'Notas 2',
        7.4,
      ],
    );
    await seedEvaluationScoresForEvaluation(firstEvaluationId);
    await seedEvaluationScoresForEvaluation(secondEvaluationId);
    await db.query(
      `INSERT INTO reports (
        player_name, player_surname, club, team, overall_rating, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Mario', 'Sanz', context.club.name, 'Juvenil Eval', 7.2, context.admin.id, '2026-03-20 10:00:00'],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Resumen del jugador');
    expect(res.text).toContain('Cómo va');
    expect(res.text).toContain('Evolución simple');
    expect(res.text).toContain('Historial de evaluaciones');
    expect(res.text).toContain('Historial de informes');
    expect(res.text).toContain('Seguimiento marzo');
    expect(res.text).toContain('Nueva evaluación');
    expect(res.text).toContain('Nuevo informe');
    expect(res.text).toContain('Volver al equipo');
    expect(res.text).toContain('playerRadarChart');
    expect(res.text).not.toContain('Informacion personal');
    expect(res.text).not.toContain('Contexto futbolistico');
  });

  test('player profile en pmv muestra comparativa con la media del equipo', async () => {
    const context = await createEvaluationContext('Club Perfil Benchmark PMV');
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
    );
    await seedTeamBenchmarkFixture(context);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Jugador vs media del equipo');
    expect(res.text).toContain('Media global jugador');
    expect(res.text).toContain('Media global equipo');
    expect(res.text).toContain('Diferencia global');
    expect(res.text).toContain('Tecnica');
    expect(res.text).toContain('El jugador se sitúa por encima de la media del equipo');
    expect(res.text).toContain('Media equipo');
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

  test('player profile en pmv oculta comparativa si el equipo no tiene base suficiente', async () => {
    const context = await createEvaluationContext('Club Perfil Benchmark Empty');
    await db.query(
      'UPDATE clubs SET product_mode = ? WHERE id = ?',
      ['pmv_player_tracking', context.club.id],
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
        '2026-03-10',
        'manual',
        'Solo una',
        'Notas',
        7.1,
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
    expect(res.text).toContain('Jugador vs media del equipo');
    expect(res.text).toContain('Aún no hay suficientes evaluaciones para comparar al jugador con su equipo.');
  });

  test('player profile muestra informes y evaluaciones deshabilitados si scouting players no está activo', async () => {
    const context = await createEvaluationContext('Club Perfil Module Off');
    await setModuleEnabledForClub(context.club.id, 'scouting_players', false);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/players/${context.playerId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Mario Sanz');
    expect(res.text).toContain('Disponible con el módulo Scouting Players');
    expect(res.text).toContain('Aquí verás los informes individuales del jugador');
    expect(res.text).toContain('En este bloque aparecerán las evaluaciones del jugador');
    expect(res.text).toContain('button type="button" class="btn btn-outline-secondary" disabled');
    expect(res.text).not.toContain('playerRadarChart');
  });

  test('evaluation detail ofrece vuelta a la ficha del jugador', async () => {
    const context = await createEvaluationContext('Club Evaluation Detail Flow');
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
        'Detalle PMV',
        'Notas',
        7.4,
      ],
    );
    await seedEvaluationScoresForEvaluation(evaluationId);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: 'password123',
    });

    const res = await agent.get(`/evaluations/${evaluationId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/players/${context.playerId}`);
    expect(res.text).toContain('Ver ficha del jugador');
  });

  test('report detail enlaza a la ficha del jugador cuando puede resolverla', async () => {
    const context = await createEvaluationContext('Club Report Detail Flow');
    const [insertResult] = await db.query(
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

    const res = await agent.get(`/reports/${insertResult.insertId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/players/${context.playerId}`);
    expect(res.text).toContain('Ver ficha del jugador');
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
    expect(res.text).toContain('SPI Core');
    expect(res.text).toContain('Seguimiento operativo de evaluaciones');
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
    expect(res.text).toContain('1 equipos activos');
    expect(res.text).toContain('1 jugadores activos');
    expect(res.text).toContain('1 informes en temporada');
    expect(res.text).toContain('SPI Scouting Players');
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

  test('PDF route muestra la foto del jugador cuando existe', async () => {
    const context = await createEvaluationContext('Club PDF Photo');
    await db.query(
      'UPDATE players SET photo_path = ? WHERE id = ?',
      ['/uploads/players/pdf-photo-test.png', context.playerId],
    );

    const agent = request.agent(app);
    await agent.post('/login').send({ email: context.admin.email, password: 'password123' });

    const res = await agent.get(`/players/${context.playerId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('/uploads/players/pdf-photo-test.png');
    expect(res.text).toContain('Foto de Mario Sanz');
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
