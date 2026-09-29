const {
  toIsoDate,
  buildMetricWindows,
  calculateExposureForPeriod,
  buildExposureComposition,
  buildWeeklyEvolution,
  buildExposureMap,
  buildPersonalHistory,
  buildPlayerAnalyticalDetail,
  buildDeterministicTrend,
} = require('../src/modules/playerLoad/services/playerLoadMetricsService');

describe('Player Load deterministic metrics', () => {
  test('normalizes only valid ISO calendar dates', () => {
    expect(toIsoDate('2026-09-28')).toBe('2026-09-28');
    expect(toIsoDate('2026-09-28T18:30:00.000Z')).toBe('2026-09-28');
    expect(toIsoDate('2026-02-30')).toBeNull();
    expect(toIsoDate('not-a-date')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });

  test('builds inclusive current and previous rolling windows', () => {
    const windows = buildMetricWindows('2026-09-28');

    expect(windows.sevenDays).toEqual(expect.objectContaining({
      dateFrom: '2026-09-22',
      dateTo: '2026-09-28',
      previous: {
        dateFrom: '2026-09-15',
        dateTo: '2026-09-21',
      },
    }));
    expect(windows.twentyEightDays).toEqual(expect.objectContaining({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-28',
      previous: {
        dateFrom: '2026-08-04',
        dateTo: '2026-08-31',
      },
    }));
  });

  test('counts only done activities and keeps players with zero exposure', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz', dorsal: '10', positions: 'MC' },
      { player_id: 2, first_name: 'Adrian', last_name: 'Lopez', dorsal: '8', positions: 'DEL' },
    ];
    const activities = [
      { id: 'training-done', activity_type: 'TRAINING', status: 'done' },
      { id: 'training-planned', activity_type: 'TRAINING', status: 'planned' },
      { id: 'match-done', activity_type: 'MATCH', status: 'done' },
      { id: 'match-cancelled', activity_type: 'MATCH', status: 'cancelled' },
    ];
    const entries = [
      {
        activity_id: 'training-done',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        exposure_minutes: 60,
      },
      {
        activity_id: 'training-planned',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        exposure_minutes: 90,
      },
      {
        activity_id: 'match-done',
        player_id: 1,
        attended: true,
        activity_type: 'MATCH',
        exposure_minutes: 0,
      },
      {
        activity_id: 'match-done',
        player_id: 2,
        attended: true,
        activity_type: 'MATCH',
        exposure_minutes: 30,
      },
      {
        activity_id: 'match-cancelled',
        player_id: 2,
        attended: true,
        activity_type: 'MATCH',
        exposure_minutes: 90,
      },
    ];

    const result = calculateExposureForPeriod(roster, activities, entries);
    const mario = result.players.find((player) => player.playerId === 1);
    const adrian = result.players.find((player) => player.playerId === 2);

    expect(mario).toEqual(expect.objectContaining({
      trainingSessions: 1,
      availableTrainingSessions: 1,
      attendancePercentage: 100,
      trainingMinutes: 60,
      matchMinutes: 0,
      totalExposureMinutes: 60,
    }));
    expect(adrian).toEqual(expect.objectContaining({
      trainingSessions: 0,
      availableTrainingSessions: 1,
      attendancePercentage: 0,
      trainingMinutes: 0,
      matchMinutes: 30,
      totalExposureMinutes: 30,
    }));
  });

  test('builds weekly evolution across month and year boundaries', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz' },
    ];
    const entries = [
      {
        activity_id: 'dec-27',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        activity_date: '2026-12-27',
        status: 'done',
        exposure_minutes: 60,
      },
      {
        activity_id: 'dec-28',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        activity_date: '2026-12-28',
        status: 'done',
        exposure_minutes: 90,
      },
      {
        activity_id: 'jan-03',
        player_id: 1,
        attended: true,
        activity_type: 'MATCH',
        activity_date: '2027-01-03',
        status: 'done',
        exposure_minutes: 30,
      },
    ];

    const evolution = buildWeeklyEvolution(roster, entries, '2027-01-03', 2);

    expect(evolution.team).toEqual([
      {
        weekStart: '2026-12-21',
        dateFrom: '2026-12-21',
        dateTo: '2026-12-27',
        trainingMinutes: 60,
        matchMinutes: 0,
        totalExposureMinutes: 60,
      },
      {
        weekStart: '2026-12-28',
        dateFrom: '2026-12-28',
        dateTo: '2027-01-03',
        trainingMinutes: 90,
        matchMinutes: 30,
        totalExposureMinutes: 120,
      },
    ]);
    expect(evolution.players[0].weeks[1]).toEqual(expect.objectContaining({
      trainingMinutes: 90,
      matchMinutes: 30,
      totalExposureMinutes: 120,
    }));
  });

  test('keeps weekly periods without activity and zero-minute players deterministic', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz' },
      { player_id: 2, first_name: 'Adrian', last_name: 'Lopez' },
    ];
    const entries = [
      {
        activity_id: 'zero-match',
        player_id: 1,
        attended: true,
        activity_type: 'MATCH',
        activity_date: '2026-09-15',
        status: 'done',
        exposure_minutes: 0,
      },
    ];

    const evolution = buildWeeklyEvolution(roster, entries, '2026-09-28', 2);

    expect(evolution.team).toEqual([
      expect.objectContaining({
        weekStart: '2026-09-21',
        totalExposureMinutes: 0,
      }),
      expect.objectContaining({
        weekStart: '2026-09-28',
        totalExposureMinutes: 0,
      }),
    ]);
    expect(evolution.players[0].weeks[0].totalExposureMinutes).toBe(0);
    expect(evolution.players[1].weeks[0].totalExposureMinutes).toBe(0);
  });

  test('ignores planned and cancelled entries in weekly evolution', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz' },
    ];
    const entries = [
      {
        activity_id: 'planned',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        activity_date: '2026-09-22',
        status: 'planned',
        exposure_minutes: 90,
      },
      {
        activity_id: 'cancelled',
        player_id: 1,
        attended: true,
        activity_type: 'MATCH',
        activity_date: '2026-09-23',
        status: 'cancelled',
        exposure_minutes: 60,
      },
      {
        activity_id: 'done',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        activity_date: '2026-09-24',
        status: 'done',
        exposure_minutes: 45,
      },
    ];

    const evolution = buildWeeklyEvolution(roster, entries, '2026-09-24', 1);

    expect(evolution.team[0]).toEqual(expect.objectContaining({
      trainingMinutes: 45,
      matchMinutes: 0,
      totalExposureMinutes: 45,
    }));
  });

  test('returns deterministic trend and composition without invented percentages', () => {
    expect(buildDeterministicTrend(120, 0)).toEqual({
      currentExposure: 120,
      previousExposure: 0,
      absoluteChange: 120,
      percentageChange: null,
      dataState: 'no_previous_activity',
    });
    expect(buildDeterministicTrend(60, 120)).toEqual({
      currentExposure: 60,
      previousExposure: 120,
      absoluteChange: -60,
      percentageChange: -50,
      dataState: 'complete',
    });
    expect(buildExposureComposition(90, 30)).toEqual({
      trainingMinutes: 90,
      matchMinutes: 30,
      totalExposureMinutes: 120,
      trainingShare: 75,
      matchShare: 25,
    });
    expect(buildExposureComposition(0, 0)).toEqual({
      trainingMinutes: 0,
      matchMinutes: 0,
      totalExposureMinutes: 0,
      trainingShare: null,
      matchShare: null,
    });
  });

  test('builds personal history from current, previous, four-week average and season range', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz' },
    ];
    const entries = [
      ['2026-08-31', 40],
      ['2026-09-07', 80],
      ['2026-09-14', 120],
      ['2026-09-21', 160],
      ['2026-09-28', 200],
    ].map(([date, minutes], index) => ({
      activity_id: `week-${index}`,
      player_id: 1,
      attended: true,
      activity_type: 'TRAINING',
      activity_date: date,
      status: 'done',
      exposure_minutes: minutes,
    }));

    const [history] = buildPersonalHistory(roster, entries, '2026-09-28');

    expect(history).toEqual(expect.objectContaining({
      playerId: 1,
      currentWeekExposure: 200,
      previousWeekExposure: 160,
      previousFourCompleteWeeksAverage: 100,
      differenceFromFourWeekAverage: 100,
      percentageDifferenceFromFourWeekAverage: 100,
      seasonMaxWeeklyExposure: 200,
      seasonMinWeeklyExposureWithActivity: 40,
    }));
  });

  test('builds exposure map with relative intensity and zero-minute states', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz', dorsal: '10', positions: 'MC' },
      { player_id: 2, first_name: 'Adrian', last_name: 'Lopez', dorsal: '8', positions: 'DEL' },
    ];
    const entries = [
      {
        activity_id: 'week-one',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        activity_date: '2026-09-14',
        status: 'done',
        exposure_minutes: 100,
      },
      {
        activity_id: 'week-two-training',
        player_id: 1,
        attended: true,
        activity_type: 'TRAINING',
        activity_date: '2026-09-21',
        status: 'done',
        exposure_minutes: 200,
      },
      {
        activity_id: 'week-two-match',
        player_id: 1,
        attended: true,
        activity_type: 'MATCH',
        activity_date: '2026-09-22',
        status: 'done',
        exposure_minutes: 100,
      },
    ];
    const weeklyEvolution = buildWeeklyEvolution(roster, entries, '2026-09-28', 3);

    const map = buildExposureMap(weeklyEvolution, { weekLimit: 3 });
    const mario = map.rows.find((row) => row.playerId === 1);
    const adrian = map.rows.find((row) => row.playerId === 2);

    expect(map.maxExposure).toBe(300);
    expect(map.weeks).toHaveLength(3);
    expect(mario.cells.map((cell) => cell.totalExposureMinutes)).toEqual([100, 300, 0]);
    expect(mario.cells[1]).toEqual(expect.objectContaining({
      trainingMinutes: 200,
      matchMinutes: 100,
      intensity: 100,
      state: 'active',
    }));
    expect(mario.cells[2]).toEqual(expect.objectContaining({
      totalExposureMinutes: 0,
      intensity: 0,
      state: 'no_activity',
    }));
    expect(adrian.cells.every((cell) => cell.totalExposureMinutes === 0)).toBe(true);
    expect(adrian.cells.every((cell) => cell.state === 'no_activity')).toBe(true);
    expect(mario.cells[1].tooltip).toContain('entrenamiento 200 min');
    expect(mario.cells[1].tooltip).toContain('competicion 100 min');
    expect(mario.cells[1].tooltip).toContain('total 300 min');
  });

  test('builds individual analytical detail from existing activities and entries', () => {
    const roster = [
      { player_id: 1, first_name: 'Mario', last_name: 'Sanz', dorsal: '10', positions: 'MC', team_name: 'Juvenil Load' },
      { player_id: 2, first_name: 'Adrian', last_name: 'Lopez', dorsal: '8', positions: 'DEL', team_name: 'Juvenil Load' },
    ];
    const activities = [
      { id: 't1', activity_type: 'TRAINING', activity_date: '2026-09-22', title: 'Sesion 1', status: 'done' },
      { id: 't2', activity_type: 'TRAINING', activity_date: '2026-09-24', title: 'Sesion 2', status: 'done' },
      { id: 't3', activity_type: 'TRAINING', activity_date: '2026-09-25', title: 'Sesion 3', status: 'done' },
      { id: 'm1', activity_type: 'MATCH', activity_date: '2026-09-27', title: 'Liga 1', status: 'done' },
      { id: 'm2', activity_type: 'MATCH', activity_date: '2026-09-28', title: 'Liga 2', status: 'done' },
      { id: 'planned', activity_type: 'TRAINING', activity_date: '2026-09-29', title: 'Planificada', status: 'planned' },
    ];
    const entries = [
      { activity_id: 't1', player_id: 1, attended: true, activity_type: 'TRAINING', activity_date: '2026-09-22', status: 'done', exposure_minutes: 90 },
      { activity_id: 't2', player_id: 1, attended: false, activity_type: 'TRAINING', activity_date: '2026-09-24', status: 'done', exposure_minutes: 0 },
      { activity_id: 't3', player_id: 1, attended: true, activity_type: 'TRAINING', activity_date: '2026-09-25', status: 'done', exposure_minutes: 80 },
      { activity_id: 'm1', player_id: 1, attended: true, activity_type: 'MATCH', activity_date: '2026-09-27', status: 'done', exposure_minutes: 60 },
      { activity_id: 'm2', player_id: 1, attended: true, activity_type: 'MATCH', activity_date: '2026-09-28', status: 'done', exposure_minutes: 0 },
      { activity_id: 'planned', player_id: 1, attended: true, activity_type: 'TRAINING', activity_date: '2026-09-29', status: 'planned', exposure_minutes: 90 },
    ];
    const windows = buildMetricWindows('2026-09-28');
    const summaries = Object.fromEntries(Object.entries(windows).map(([key, window]) => {
      const periodEntries = entries.filter((entry) => !window.dateFrom || (
        entry.activity_date >= window.dateFrom && entry.activity_date <= window.dateTo
      ));
      const periodActivities = activities.filter((activity) => !window.dateFrom || (
        activity.activity_date >= window.dateFrom && activity.activity_date <= window.dateTo
      ));
      return [key, {
        ...window,
        ...calculateExposureForPeriod(roster, periodActivities, periodEntries),
      }];
    }));
    const weeklyEvolution = buildWeeklyEvolution(roster, entries, '2026-09-28', 8);
    const personalHistory = buildPersonalHistory(roster, entries, '2026-09-28');

    const detail = buildPlayerAnalyticalDetail({
      selectedPlayerId: 1,
      roster,
      activities,
      entries,
      windows: summaries,
      weeklyEvolution,
      personalHistory,
      selectedTeam: { name: 'Juvenil Load' },
      activeSeason: { name: '2026/27' },
      referenceDate: '2026-09-28',
    });

    expect(detail.identification).toEqual(expect.objectContaining({
      fullName: 'Mario Sanz',
      dorsal: '10',
      positions: 'MC',
      teamName: 'Juvenil Load',
      seasonName: '2026/27',
    }));
    expect(detail.exposure.sevenDays).toEqual(expect.objectContaining({
      trainingMinutes: 170,
      matchMinutes: 60,
      totalExposureMinutes: 230,
    }));
    expect(detail.competition).toEqual({
      totalMatchMinutes: 60,
      matchesWithParticipation: 1,
      registeredMatches: 2,
      averageMinutesPerParticipatedMatch: 60,
    });
    expect(detail.trainings).toEqual(expect.objectContaining({
      attendedSessions: 2,
      availableSessions: 3,
      attendancePercentage: 66.7,
      accumulatedMinutes: 170,
    }));
    expect(detail.trainings.latestSessions).toHaveLength(3);
    expect(detail.continuity).toEqual({
      lastActivityDate: '2026-09-28',
      daysSinceLastActivity: 0,
      consecutiveTrainingAttended: 1,
      consecutiveTrainingMissed: 0,
    });
    expect(detail.activityHistory.map((item) => item.title)).toEqual([
      'Planificada',
      'Liga 2',
      'Liga 1',
      'Sesion 3',
      'Sesion 2',
      'Sesion 1',
    ]);
    expect(detail.activityHistory[0]).toEqual(expect.objectContaining({
      attendanceLabel: 'Planificada',
      minutes: 0,
    }));
    expect(detail.weeklyEvolution).toHaveLength(8);
  });
});
