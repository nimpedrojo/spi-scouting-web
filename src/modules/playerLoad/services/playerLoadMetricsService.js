const WINDOW_DEFINITIONS = {
  sevenDays: { key: 'sevenDays', days: 7, label: 'Ultimos 7 dias' },
  twentyEightDays: { key: 'twentyEightDays', days: 28, label: 'Ultimos 28 dias' },
  season: { key: 'season', days: null, label: 'Temporada' },
};

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const candidate = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return null;
  }

  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    return null;
  }

  return candidate;
}

function parseIsoDateToUtc(value) {
  const isoDate = toIsoDate(value);
  if (!isoDate) {
    return null;
  }
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function addDays(value, amount) {
  const date = parseIsoDateToUtc(value);
  if (!date) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}

function buildRollingWindow(days, referenceDate) {
  const dateTo = toIsoDate(referenceDate);
  const dateFrom = addDays(dateTo, -(days - 1));
  return { dateFrom, dateTo };
}

function buildPreviousWindow(days, currentWindow) {
  if (!currentWindow || !currentWindow.dateFrom) {
    return null;
  }

  return {
    dateFrom: addDays(currentWindow.dateFrom, -days),
    dateTo: addDays(currentWindow.dateFrom, -1),
  };
}

function buildMetricWindows(referenceDate = new Date()) {
  const safeReferenceDate = toIsoDate(referenceDate) || toIsoDate(new Date());
  const sevenDays = buildRollingWindow(7, safeReferenceDate);
  const twentyEightDays = buildRollingWindow(28, safeReferenceDate);

  return {
    sevenDays: {
      ...WINDOW_DEFINITIONS.sevenDays,
      ...sevenDays,
      previous: buildPreviousWindow(7, sevenDays),
    },
    twentyEightDays: {
      ...WINDOW_DEFINITIONS.twentyEightDays,
      ...twentyEightDays,
      previous: buildPreviousWindow(28, twentyEightDays),
    },
    season: {
      ...WINDOW_DEFINITIONS.season,
      dateFrom: null,
      dateTo: null,
      previous: null,
    },
  };
}

function createEmptyPlayerMetrics(player, availableTrainingSessions = 0) {
  return {
    playerId: Number(player.player_id || player.id),
    fullName: `${player.first_name || ''} ${player.last_name || ''}`.trim(),
    dorsal: player.dorsal || '',
    positions: player.positions || '',
    trainingSessions: 0,
    availableTrainingSessions,
    attendancePercentage: availableTrainingSessions > 0 ? 0 : null,
    trainingMinutes: 0,
    matchMinutes: 0,
    totalExposureMinutes: 0,
  };
}

function isDoneActivity(activity) {
  return !activity.status || activity.status === 'done';
}

function calculateExposureForPeriod(roster, activities, entries) {
  const completedActivityIds = new Set(
    activities
      .filter(isDoneActivity)
      .map((activity) => String(activity.id)),
  );
  const trainingActivityIds = new Set(
    activities
      .filter((activity) => activity.activity_type === 'TRAINING' && isDoneActivity(activity))
      .map((activity) => String(activity.id)),
  );
  const availableTrainingSessions = trainingActivityIds.size;
  const byPlayer = new Map();

  roster.forEach((player) => {
    const playerId = Number(player.player_id || player.id);
    byPlayer.set(String(playerId), createEmptyPlayerMetrics(player, availableTrainingSessions));
  });

  entries.forEach((entry) => {
    const playerMetrics = byPlayer.get(String(entry.player_id));
    if (!playerMetrics || !entry.attended || !completedActivityIds.has(String(entry.activity_id))) {
      return;
    }

    if (entry.activity_type === 'TRAINING') {
      playerMetrics.trainingSessions += 1;
      playerMetrics.trainingMinutes += Number(entry.exposure_minutes || 0);
    } else if (entry.activity_type === 'MATCH') {
      playerMetrics.matchMinutes += Number(entry.exposure_minutes || 0);
    }
  });

  const players = [...byPlayer.values()].map((playerMetrics) => {
    const totalExposureMinutes = playerMetrics.trainingMinutes + playerMetrics.matchMinutes;
    return {
      ...playerMetrics,
      totalExposureMinutes,
      attendancePercentage: playerMetrics.availableTrainingSessions > 0
        ? Math.round((playerMetrics.trainingSessions / playerMetrics.availableTrainingSessions) * 1000) / 10
        : null,
    };
  });

  return {
    players,
    teamAverage: calculateTeamAverage(players),
  };
}

function calculateTeamAverage(playerMetrics) {
  if (!Array.isArray(playerMetrics) || !playerMetrics.length) {
    return {
      trainingSessions: 0,
      availableTrainingSessions: 0,
      attendancePercentage: null,
      trainingMinutes: 0,
      matchMinutes: 0,
      totalExposureMinutes: 0,
    };
  }

  const total = playerMetrics.reduce((acc, player) => ({
    trainingSessions: acc.trainingSessions + Number(player.trainingSessions || 0),
    availableTrainingSessions: acc.availableTrainingSessions + Number(player.availableTrainingSessions || 0),
    attendancePercentage: acc.attendancePercentage + Number(player.attendancePercentage || 0),
    attendanceCount: acc.attendanceCount + (player.attendancePercentage === null ? 0 : 1),
    trainingMinutes: acc.trainingMinutes + Number(player.trainingMinutes || 0),
    matchMinutes: acc.matchMinutes + Number(player.matchMinutes || 0),
    totalExposureMinutes: acc.totalExposureMinutes + Number(player.totalExposureMinutes || 0),
  }), {
    trainingSessions: 0,
    availableTrainingSessions: 0,
    attendancePercentage: 0,
    attendanceCount: 0,
    trainingMinutes: 0,
    matchMinutes: 0,
    totalExposureMinutes: 0,
  });
  const count = playerMetrics.length;

  return {
    trainingSessions: total.trainingSessions / count,
    availableTrainingSessions: total.availableTrainingSessions / count,
    attendancePercentage: total.attendanceCount > 0
      ? Math.round((total.attendancePercentage / total.attendanceCount) * 10) / 10
      : null,
    trainingMinutes: total.trainingMinutes / count,
    matchMinutes: total.matchMinutes / count,
    totalExposureMinutes: total.totalExposureMinutes / count,
  };
}

function buildVariation(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);

  return {
    absolute: current - previous,
    percentage: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
  };
}

function decorateComparisons(currentPlayers, previousPlayers, teamAverage) {
  const previousByPlayer = new Map(
    previousPlayers.map((player) => [String(player.playerId), player]),
  );

  return currentPlayers.map((player) => {
    const previous = previousByPlayer.get(String(player.playerId)) || createEmptyPlayerMetrics(player, 0);
    const teamAverageTotal = Number(teamAverage.totalExposureMinutes || 0);

    return {
      ...player,
      previousPeriodVariation: {
        trainingMinutes: buildVariation(player.trainingMinutes, previous.trainingMinutes),
        matchMinutes: buildVariation(player.matchMinutes, previous.matchMinutes),
        totalExposureMinutes: buildVariation(player.totalExposureMinutes, previous.totalExposureMinutes),
      },
      teamAverageDifference: {
        trainingMinutes: Number(player.trainingMinutes || 0) - Number(teamAverage.trainingMinutes || 0),
        matchMinutes: Number(player.matchMinutes || 0) - Number(teamAverage.matchMinutes || 0),
        totalExposureMinutes: Number(player.totalExposureMinutes || 0) - teamAverageTotal,
        totalExposurePercentage: teamAverageTotal > 0
          ? Math.round(((Number(player.totalExposureMinutes || 0) / teamAverageTotal) - 1) * 1000) / 10
          : null,
      },
    };
  });
}

function buildTemporalEvolution(entries) {
  const byDate = new Map();

  entries.forEach((entry) => {
    if (!entry.attended || (entry.status && entry.status !== 'done')) {
      return;
    }

    const isoDate = toIsoDate(entry.activity_date);
    if (!isoDate) {
      return;
    }

    if (!byDate.has(isoDate)) {
      byDate.set(isoDate, {
        date: isoDate,
        trainingMinutes: 0,
        matchMinutes: 0,
        totalExposureMinutes: 0,
      });
    }

    const bucket = byDate.get(isoDate);
    if (entry.activity_type === 'TRAINING') {
      bucket.trainingMinutes += Number(entry.exposure_minutes || 0);
    } else if (entry.activity_type === 'MATCH') {
      bucket.matchMinutes += Number(entry.exposure_minutes || 0);
    }
    bucket.totalExposureMinutes = bucket.trainingMinutes + bucket.matchMinutes;
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  WINDOW_DEFINITIONS,
  toIsoDate,
  buildMetricWindows,
  calculateExposureForPeriod,
  calculateTeamAverage,
  decorateComparisons,
  buildTemporalEvolution,
};
