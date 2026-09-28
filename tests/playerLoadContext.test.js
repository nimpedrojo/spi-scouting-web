const {
  CONTEXT_SCHEMA_VERSION,
  buildPlayerLoadContext,
} = require('../src/modules/playerLoad/services/playerLoadContextService');

function buildFixture() {
  const mario = {
    playerId: 1,
    fullName: 'Mario Sanz',
    dorsal: '10',
    positions: 'MC',
    trainingSessions: 1,
    availableTrainingSessions: 1,
    attendancePercentage: 100,
    trainingMinutes: 90,
    matchMinutes: 60,
    totalExposureMinutes: 150,
    previousPeriodVariation: {
      trainingMinutes: { absolute: 45, percentage: 100 },
      matchMinutes: { absolute: 60, percentage: null },
      totalExposureMinutes: { absolute: 105, percentage: 233.3 },
    },
    teamAverageDifference: {
      trainingMinutes: 45,
      matchMinutes: 15,
      totalExposureMinutes: 60,
      totalExposurePercentage: 66.7,
    },
  };
  const adrian = {
    playerId: 2,
    fullName: 'Adrian Lopez',
    dorsal: '8',
    positions: 'DEL',
    trainingSessions: 0,
    availableTrainingSessions: 1,
    attendancePercentage: 0,
    trainingMinutes: 0,
    matchMinutes: 30,
    totalExposureMinutes: 30,
    previousPeriodVariation: {
      trainingMinutes: { absolute: 0, percentage: null },
      matchMinutes: { absolute: 30, percentage: null },
      totalExposureMinutes: { absolute: 30, percentage: null },
    },
    teamAverageDifference: {
      trainingMinutes: -45,
      matchMinutes: -15,
      totalExposureMinutes: -60,
      totalExposurePercentage: -66.7,
    },
  };

  return {
    club: { id: 11, name: 'Club Test' },
    activeSeason: { id: 'season-1', name: '2026/27' },
    selectedTeam: { id: 'team-1', name: 'Juvenil A' },
    roster: [{ player_id: 1 }, { player_id: 2 }],
    selectedPeriod: 'sevenDays',
    exposureDefinition: 'Observed exposure in training and match minutes.',
    teamSummary: {
      totalExposureMinutes: 180,
      averageExposureMinutes: 90,
      averageAttendancePercentage: 50,
      matchMinutes: 90,
      distribution: [
        { playerId: 1, fullName: 'Mario Sanz', totalExposureMinutes: 150, percentage: 83.3 },
        { playerId: 2, fullName: 'Adrian Lopez', totalExposureMinutes: 30, percentage: 16.7 },
      ],
    },
    windows: {
      sevenDays: {
        key: 'sevenDays',
        label: 'Ultimos 7 dias',
        dateFrom: '2026-09-22',
        dateTo: '2026-09-28',
        players: [mario, adrian],
        teamAverage: {
          trainingSessions: 0.5,
          availableTrainingSessions: 1,
          attendancePercentage: 50,
          trainingMinutes: 45,
          matchMinutes: 45,
          totalExposureMinutes: 90,
        },
        evolution: [
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
        ],
      },
    },
    selectedWindow: null,
    playerDetail: {
      player: mario,
      evolution: [
        {
          date: '2026-09-25',
          trainingMinutes: 90,
          matchMinutes: 0,
          totalExposureMinutes: 90,
        },
        {
          date: '2026-09-27',
          trainingMinutes: 0,
          matchMinutes: 60,
          totalExposureMinutes: 60,
        },
      ],
    },
  };
}

describe('Player Load context service', () => {
  test('builds a provider-neutral deterministic context from precomputed metrics', () => {
    const context = buildPlayerLoadContext(buildFixture(), {
      periodKey: 'sevenDays',
      playerIds: [1, 2],
    });

    expect(context.schemaVersion).toBe(CONTEXT_SCHEMA_VERSION);
    expect(context.domain).toEqual(expect.objectContaining({
      metricType: 'observed_exposure',
      calculationOwner: 'backend',
      totalExposureFormula: 'trainingMinutes + matchMinutes',
    }));
    expect(context.period).toEqual({
      key: 'sevenDays',
      label: 'Ultimos 7 dias',
      dateFrom: '2026-09-22',
      dateTo: '2026-09-28',
    });
    expect(context.scope).toEqual(expect.objectContaining({
      clubId: 11,
      seasonId: 'season-1',
      teamId: 'team-1',
    }));

    const mario = context.players.find((player) => player.player.id === 1);
    expect(mario).toEqual(expect.objectContaining({
      player: expect.objectContaining({ fullName: 'Mario Sanz' }),
      training: {
        sessions: 1,
        availableSessions: 1,
        attendancePercentage: 100,
        minutes: 90,
      },
      matches: { minutes: 60 },
      exposure: {
        totalMinutes: 150,
        formula: 'trainingMinutes + matchMinutes',
      },
      previousPeriod: expect.objectContaining({
        totalExposureMinutesDelta: 105,
        totalExposurePercentageDelta: 233.3,
      }),
      teamComparison: expect.objectContaining({
        totalExposureMinutesDifferenceFromAverage: 60,
        totalExposurePercentageDifferenceFromAverage: 66.7,
      }),
      trend: {
        direction: 'up',
        totalExposureMinutesDelta: 105,
        totalExposurePercentageDelta: 233.3,
      },
    }));
    expect(mario.evolution).toHaveLength(2);
  });

  test('orders ready-to-use rankings and comparison without asking a consumer to calculate metrics', () => {
    const context = buildPlayerLoadContext(buildFixture(), {
      periodKey: 'sevenDays',
      playerIds: [1, 2],
      rankingLimit: 2,
    });

    expect(context.rankings.highestExposure.map((entry) => entry.player.fullName)).toEqual([
      'Mario Sanz',
      'Adrian Lopez',
    ]);
    expect(context.rankings.largestExposureIncrease[0]).toEqual({
      player: expect.objectContaining({ id: 1, fullName: 'Mario Sanz' }),
      totalExposureMinutesDelta: 105,
    });
    expect(context.rankings.lowestMatchMinutes[0]).toEqual({
      player: expect.objectContaining({ id: 2, fullName: 'Adrian Lopez' }),
      matchMinutes: 30,
    });

    expect(context.comparisons).toHaveLength(1);
    expect(context.comparisons[0].deltas.firstMinusSecond).toEqual({
      trainingMinutes: 90,
      matchMinutes: 30,
      totalExposureMinutes: 120,
      attendancePercentage: 100,
    });
  });
});
