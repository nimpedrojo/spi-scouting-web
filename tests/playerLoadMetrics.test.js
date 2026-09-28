const {
  toIsoDate,
  buildMetricWindows,
  calculateExposureForPeriod,
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
});
