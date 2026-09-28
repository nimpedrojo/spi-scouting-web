const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../src/app');
const db = require('../src/db');
const { initDatabaseOnce } = require('../src/initDb');
const { setModuleEnabledForClub } = require('../src/core/models/clubModuleModel');

function buildUserEmail() {
  return `player_load_${Date.now()}_${Math.random().toString(16).slice(2)}@local`;
}

async function createPlayerLoadContext() {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const [clubResult] = await db.query(
    'INSERT INTO clubs (name, code) VALUES (?, ?)',
    [`Club Player Load ${suffix}`, `pl_${suffix}`],
  );
  const club = {
    id: clubResult.insertId,
    name: `Club Player Load ${suffix}`,
  };

  const seasonId = randomUUID();
  await db.query(
    'INSERT INTO seasons (id, club_id, name, is_active) VALUES (?, ?, ?, 1)',
    [seasonId, club.id, '2026/27'],
  );

  const [sectionRows] = await db.query('SELECT id FROM sections WHERE name = ? LIMIT 1', ['Masculina']);
  const [categoryRows] = await db.query('SELECT id FROM categories WHERE name = ? LIMIT 1', ['Juvenil']);
  const teamId = randomUUID();
  await db.query(
    `INSERT INTO teams (id, club_id, season_id, section_id, category_id, name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [teamId, club.id, seasonId, sectionRows[0].id, categoryRows[0].id, 'Juvenil Load'],
  );

  const adminEmail = buildUserEmail();
  const [adminResult] = await db.query(
    `INSERT INTO users (
      name, email, password_hash, role, club_id, default_club, default_team, default_team_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'Admin Load',
      adminEmail,
      '$2b$10$dqViRKNFig.H8Ewz7IcQf.eiq..3sKjdfT9lsbHPq1xHSnzM6Sjsi',
      'admin',
      club.id,
      club.name,
      'Juvenil Load',
      teamId,
    ],
  );

  const [playerOneResult] = await db.query(
    `INSERT INTO players (
      first_name, last_name, club, club_id, current_team_id, team, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ['Mario', 'Sanz', club.name, club.id, teamId, 'Juvenil Load'],
  );
  const [playerTwoResult] = await db.query(
    `INSERT INTO players (
      first_name, last_name, club, club_id, current_team_id, team, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ['Adrian', 'Lopez', club.name, club.id, teamId, 'Juvenil Load'],
  );

  await db.query(
    `INSERT INTO team_players (id, team_id, player_id, dorsal, positions)
     VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      teamId,
      playerOneResult.insertId,
      '10',
      'MC',
      randomUUID(),
      teamId,
      playerTwoResult.insertId,
      '8',
      'DEL',
    ],
  );

  return {
    club,
    seasonId,
    teamId,
    admin: {
      id: adminResult.insertId,
      email: adminEmail,
      password: 'password123',
    },
    playerOneId: playerOneResult.insertId,
    playerTwoId: playerTwoResult.insertId,
  };
}

async function cleanupContext(context) {
  if (!context) {
    return;
  }

  await db.query(
    `DELETE ple FROM player_load_entries ple
     INNER JOIN player_load_activities pla ON pla.id = ple.activity_id
     WHERE pla.club_id = ?`,
    [context.club.id],
  );
  await db.query('DELETE FROM player_load_activities WHERE club_id = ?', [context.club.id]);
  await db.query('DELETE FROM team_players WHERE team_id = ?', [context.teamId]);
  await db.query('DELETE FROM players WHERE club_id = ?', [context.club.id]);
  await db.query('DELETE FROM users WHERE id = ?', [context.admin.id]);
  await db.query('DELETE FROM club_modules WHERE club_id = ?', [context.club.id]);
  await db.query('DELETE FROM teams WHERE id = ?', [context.teamId]);
  await db.query('DELETE FROM seasons WHERE id = ?', [context.seasonId]);
  await db.query('DELETE FROM clubs WHERE id = ?', [context.club.id]);
}

describe('Player Load MVP backend', () => {
  let context = null;

  beforeAll(async () => {
    await initDatabaseOnce();
  });

  afterEach(async () => {
    await cleanupContext(context);
    context = null;
  });

  afterAll(async () => {
    await db.end();
  });

  test('requires enabled module before exposing Player Load endpoints', async () => {
    context = await createPlayerLoadContext();

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: context.admin.password,
    });

    const res = await agent
      .get(`/player-load?team_id=${context.teamId}`)
      .set('Accept', 'application/json');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('MODULE_DISABLED');
  });

  test('creates training and match activities and calculates exposure metrics', async () => {
    context = await createPlayerLoadContext();
    await setModuleEnabledForClub(context.club.id, 'player_load', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: context.admin.password,
    });

    const previousTraining = await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-09-18',
      title: 'Entrenamiento previo',
      duration_minutes: 45,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 45 },
        { player_id: context.playerTwoId, attended: false, exposure_minutes: 0 },
      ],
    });
    expect(previousTraining.status).toBe(201);

    const training = await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-09-25',
      title: 'Sesion campo',
      duration_minutes: 90,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 90 },
        { player_id: context.playerTwoId, attended: false, exposure_minutes: 0 },
      ],
    });
    expect(training.status).toBe(201);

    const match = await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'MATCH',
      activity_date: '2026-09-27',
      title: 'Liga Juvenil',
      duration_minutes: 90,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 60 },
        { player_id: context.playerTwoId, attended: true, exposure_minutes: 30 },
      ],
    });
    expect(match.status).toBe(201);

    const res = await agent
      .get(`/player-load?team_id=${context.teamId}&reference_date=2026-09-28`)
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.playerLoad.exposureDefinition).toContain('exposicion observada');

    const sevenDays = res.body.playerLoad.windows.sevenDays;
    const playerOne = sevenDays.players.find((player) => player.playerId === context.playerOneId);
    const playerTwo = sevenDays.players.find((player) => player.playerId === context.playerTwoId);

    expect(playerOne).toEqual(expect.objectContaining({
      trainingSessions: 1,
      availableTrainingSessions: 1,
      attendancePercentage: 100,
      trainingMinutes: 90,
      matchMinutes: 60,
      totalExposureMinutes: 150,
    }));
    expect(playerOne.previousPeriodVariation.totalExposureMinutes.absolute).toBe(105);
    expect(playerOne.teamAverageDifference.totalExposureMinutes).toBe(60);

    expect(playerTwo).toEqual(expect.objectContaining({
      trainingSessions: 0,
      availableTrainingSessions: 1,
      attendancePercentage: 0,
      trainingMinutes: 0,
      matchMinutes: 30,
      totalExposureMinutes: 30,
    }));

    expect(res.body.playerLoad.windows.twentyEightDays.players).toHaveLength(2);
    expect(res.body.playerLoad.windows.season.players).toHaveLength(2);
    const seasonPlayerOne = res.body.playerLoad.windows.season.players
      .find((player) => player.playerId === context.playerOneId);
    expect(seasonPlayerOne.previousPeriodVariation.totalExposureMinutes.absolute).toBe(0);
    expect(sevenDays.evolution).toEqual([
      {
        date: '2026-09-25',
        trainingMinutes: 90,
        matchMinutes: 0,
        totalExposureMinutes: 90,
      },
      {
        date: '2026-09-27',
        trainingMinutes: 0,
        matchMinutes: 90,
        totalExposureMinutes: 90,
      },
    ]);
  });

  test('renders team-oriented Player Load dashboard and player detail', async () => {
    context = await createPlayerLoadContext();
    await setModuleEnabledForClub(context.club.id, 'player_load', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: context.admin.password,
    });

    await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-09-25',
      title: 'Sesion campo',
      duration_minutes: 90,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 90 },
        { player_id: context.playerTwoId, attended: true, exposure_minutes: 80 },
      ],
    });
    await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'MATCH',
      activity_date: '2026-09-27',
      title: 'Liga Juvenil',
      duration_minutes: 90,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 60 },
        { player_id: context.playerTwoId, attended: true, exposure_minutes: 30 },
      ],
    });

    const res = await agent.get(
      `/player-load?team_id=${context.teamId}&season_id=${context.seasonId}&period=sevenDays&player_id=${context.playerOneId}&reference_date=2026-09-28`,
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain('Exposicion del equipo');
    expect(res.text).toContain('Player');
    expect(res.text).toContain('Training');
    expect(res.text).toContain('Match min');
    expect(res.text).toContain('Exposure 7D');
    expect(res.text).toContain('Exposure 28D');
    expect(res.text).toContain('Trend');
    expect(res.text).toContain('Exposicion total');
    expect(res.text).toContain('Media por jugador');
    expect(res.text).toContain('Asistencia media');
    expect(res.text).toContain('Distribucion');
    expect(res.text).toContain('Mario Sanz');
    expect(res.text).toContain('Detalle de jugador');
    expect(res.text).toContain('Evolucion temporal');
    expect(res.text).toContain('Comparacion con el equipo');
    expect(res.text).not.toContain('riesgo de lesión');
    expect(res.text).not.toContain('fatiga');
    expect(res.text).not.toContain('sobrecarga');
    expect(res.text).not.toContain('estado físico');
  });

  test('rejects invalid activity payloads', async () => {
    context = await createPlayerLoadContext();
    await setModuleEnabledForClub(context.club.id, 'player_load', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: context.admin.password,
    });

    const res = await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-09-25',
      title: 'Sesion invalida',
      duration_minutes: -1,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: -10 },
      ],
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(expect.arrayContaining([
      'La duracion de la sesion de entrenamiento es obligatoria.',
      'Los minutos de exposicion deben ser enteros positivos.',
    ]));
  });

  test('ignores non-done activities and keeps zero-minute match entries deterministic', async () => {
    context = await createPlayerLoadContext();
    await setModuleEnabledForClub(context.club.id, 'player_load', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: context.admin.password,
    });

    await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-09-22',
      title: 'Sesion realizada',
      duration_minutes: 60,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 60 },
        { player_id: context.playerTwoId, attended: false, exposure_minutes: 0 },
      ],
    });
    await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-09-23',
      title: 'Sesion planificada',
      duration_minutes: 90,
      status: 'planned',
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 90 },
        { player_id: context.playerTwoId, attended: true, exposure_minutes: 90 },
      ],
    });
    await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'MATCH',
      activity_date: '2026-09-28',
      title: 'Partido realizado',
      duration_minutes: 90,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 0 },
        { player_id: context.playerTwoId, attended: true, exposure_minutes: 20 },
      ],
    });

    const res = await agent
      .get(`/player-load?team_id=${context.teamId}&reference_date=2026-09-28`)
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    const sevenDays = res.body.playerLoad.windows.sevenDays;
    const playerOne = sevenDays.players.find((player) => player.playerId === context.playerOneId);
    const playerTwo = sevenDays.players.find((player) => player.playerId === context.playerTwoId);

    expect(playerOne).toEqual(expect.objectContaining({
      trainingSessions: 1,
      availableTrainingSessions: 1,
      attendancePercentage: 100,
      trainingMinutes: 60,
      matchMinutes: 0,
      totalExposureMinutes: 60,
    }));
    expect(playerTwo).toEqual(expect.objectContaining({
      trainingSessions: 0,
      availableTrainingSessions: 1,
      attendancePercentage: 0,
      trainingMinutes: 0,
      matchMinutes: 20,
      totalExposureMinutes: 20,
    }));
    expect(sevenDays.evolution).toEqual([
      {
        date: '2026-09-22',
        trainingMinutes: 60,
        matchMinutes: 0,
        totalExposureMinutes: 60,
      },
      {
        date: '2026-09-28',
        trainingMinutes: 0,
        matchMinutes: 20,
        totalExposureMinutes: 20,
      },
    ]);
  });

  test('rejects invalid dates before persistence', async () => {
    context = await createPlayerLoadContext();
    await setModuleEnabledForClub(context.club.id, 'player_load', true);

    const agent = request.agent(app);
    await agent.post('/login').send({
      email: context.admin.email,
      password: context.admin.password,
    });

    const res = await agent.post('/player-load/activities').send({
      team_id: context.teamId,
      season_id: context.seasonId,
      activity_type: 'TRAINING',
      activity_date: '2026-02-30',
      title: 'Fecha invalida',
      duration_minutes: 60,
      entries: [
        { player_id: context.playerOneId, attended: true, exposure_minutes: 60 },
      ],
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toContain('La fecha de actividad es obligatoria.');
  });
});
