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

function startOfWeek(value) {
  const date = parseIsoDateToUtc(value);
  if (!date) {
    return null;
  }
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function buildWeekWindow(weekStart) {
  const dateFrom = toIsoDate(weekStart);
  return {
    weekStart: dateFrom,
    dateFrom,
    dateTo: addDays(dateFrom, 6),
  };
}

function buildWeeklyWindows(referenceDate = new Date(), count = 8) {
  const currentWeekStart = startOfWeek(referenceDate);
  if (!currentWeekStart) {
    return [];
  }

  return Array.from({ length: count }, (_value, index) => {
    const weekStart = addDays(currentWeekStart, -7 * (count - index - 1));
    return buildWeekWindow(weekStart);
  });
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
    composition: buildExposureComposition(0, 0),
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
      composition: buildExposureComposition(playerMetrics.trainingMinutes, playerMetrics.matchMinutes),
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

function buildDeterministicTrend(currentValue, previousValue) {
  const currentExposure = Number(currentValue || 0);
  const previousExposure = Number(previousValue || 0);
  const absoluteChange = currentExposure - previousExposure;

  let dataState = 'complete';
  if (currentExposure === 0 && previousExposure === 0) {
    dataState = 'no_activity';
  } else if (currentExposure > 0 && previousExposure === 0) {
    dataState = 'no_previous_activity';
  } else if (currentExposure === 0 && previousExposure > 0) {
    dataState = 'no_current_activity';
  }

  return {
    currentExposure,
    previousExposure,
    absoluteChange,
    percentageChange: previousExposure > 0
      ? Math.round((absoluteChange / previousExposure) * 1000) / 10
      : null,
    dataState,
  };
}

function buildExposureComposition(trainingMinutes, matchMinutes) {
  const normalizedTraining = Number(trainingMinutes || 0);
  const normalizedMatch = Number(matchMinutes || 0);
  const totalExposureMinutes = normalizedTraining + normalizedMatch;

  return {
    trainingMinutes: normalizedTraining,
    matchMinutes: normalizedMatch,
    totalExposureMinutes,
    trainingShare: totalExposureMinutes > 0
      ? Math.round((normalizedTraining / totalExposureMinutes) * 1000) / 10
      : null,
    matchShare: totalExposureMinutes > 0
      ? Math.round((normalizedMatch / totalExposureMinutes) * 1000) / 10
      : null,
  };
}

function calculateTeamComposition(players = []) {
  const totals = players.reduce((acc, player) => ({
    trainingMinutes: acc.trainingMinutes + Number(player.trainingMinutes || 0),
    matchMinutes: acc.matchMinutes + Number(player.matchMinutes || 0),
  }), {
    trainingMinutes: 0,
    matchMinutes: 0,
  });

  return buildExposureComposition(totals.trainingMinutes, totals.matchMinutes);
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
      trend: buildDeterministicTrend(player.totalExposureMinutes, previous.totalExposureMinutes),
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

function isEntryDoneAndAttended(entry) {
  return Boolean(entry.attended) && (!entry.status || entry.status === 'done');
}

function isDateInRange(isoDate, window) {
  return isoDate
    && (!window.dateFrom || isoDate >= window.dateFrom)
    && (!window.dateTo || isoDate <= window.dateTo);
}

function findWeekForDate(isoDate, weeks) {
  return weeks.find((week) => isDateInRange(isoDate, week)) || null;
}

function buildEmptyWeeklyBucket(week) {
  return {
    weekStart: week.weekStart,
    dateFrom: week.dateFrom,
    dateTo: week.dateTo,
    trainingMinutes: 0,
    matchMinutes: 0,
    totalExposureMinutes: 0,
  };
}

function addEntryToWeeklyBucket(bucket, entry) {
  if (entry.activity_type === 'TRAINING') {
    bucket.trainingMinutes += Number(entry.exposure_minutes || 0);
  } else if (entry.activity_type === 'MATCH') {
    bucket.matchMinutes += Number(entry.exposure_minutes || 0);
  }
  bucket.totalExposureMinutes = bucket.trainingMinutes + bucket.matchMinutes;
}

function buildWeeklyEvolution(roster = [], entries = [], referenceDate = new Date(), count = 8) {
  const weeks = buildWeeklyWindows(referenceDate, count);
  const teamBuckets = new Map(weeks.map((week) => [week.weekStart, buildEmptyWeeklyBucket(week)]));
  const players = roster.map((player) => {
    const playerId = Number(player.player_id || player.id);
    return {
      playerId,
      fullName: `${player.first_name || ''} ${player.last_name || ''}`.trim(),
      dorsal: player.dorsal || '',
      positions: player.positions || '',
      weeks: weeks.map(buildEmptyWeeklyBucket),
    };
  });
  const playersById = new Map(players.map((player) => [String(player.playerId), player]));

  entries.forEach((entry) => {
    if (!isEntryDoneAndAttended(entry)) {
      return;
    }

    const isoDate = toIsoDate(entry.activity_date);
    const week = findWeekForDate(isoDate, weeks);
    if (!week) {
      return;
    }

    addEntryToWeeklyBucket(teamBuckets.get(week.weekStart), entry);
    const player = playersById.get(String(entry.player_id));
    if (player) {
      addEntryToWeeklyBucket(player.weeks.find((item) => item.weekStart === week.weekStart), entry);
    }
  });

  const team = weeks.map((week) => teamBuckets.get(week.weekStart));
  return {
    weeks,
    team,
    players,
  };
}

function formatWeekLabel(week) {
  return `${week.dateFrom.slice(5)}-${week.dateTo.slice(5)}`;
}

function buildExposureMap(weeklyEvolution = {}, options = {}) {
  const weekLimit = options.weekLimit || 8;
  const weeks = (weeklyEvolution.weeks || []).slice(-weekLimit);
  const weekStartSet = new Set(weeks.map((week) => week.weekStart));
  const sourcePlayers = weeklyEvolution.players || [];
  const maxExposure = sourcePlayers.reduce((maxValue, player) => {
    const playerMax = (player.weeks || [])
      .filter((week) => weekStartSet.has(week.weekStart))
      .reduce((weekMax, week) => Math.max(weekMax, Number(week.totalExposureMinutes || 0)), 0);
    return Math.max(maxValue, playerMax);
  }, 0);

  const rows = sourcePlayers.map((player) => {
    const relevantWeeks = (player.weeks || []).filter((week) => weekStartSet.has(week.weekStart));
    const firstActiveWeek = relevantWeeks.find((week) => Number(week.totalExposureMinutes || 0) > 0);

    return {
      playerId: player.playerId,
      fullName: player.fullName,
      dorsal: player.dorsal || '',
      positions: player.positions || '',
      cells: relevantWeeks.map((week) => {
        const totalExposureMinutes = Number(week.totalExposureMinutes || 0);
        const intensity = maxExposure > 0
          ? Math.round((totalExposureMinutes / maxExposure) * 100)
          : 0;
        const state = totalExposureMinutes > 0
          ? 'active'
          : (firstActiveWeek && week.weekStart < firstActiveWeek.weekStart ? 'before_first_activity' : 'no_activity');

        return {
          weekStart: week.weekStart,
          dateFrom: week.dateFrom,
          dateTo: week.dateTo,
          label: formatWeekLabel(week),
          trainingMinutes: Number(week.trainingMinutes || 0),
          matchMinutes: Number(week.matchMinutes || 0),
          totalExposureMinutes,
          intensity,
          opacity: maxExposure > 0 && totalExposureMinutes > 0
            ? Math.round((0.16 + (0.72 * (intensity / 100))) * 100) / 100
            : 0,
          state,
          tooltip: `${week.dateFrom} - ${week.dateTo}: entrenamiento ${Number(week.trainingMinutes || 0)} min, competicion ${Number(week.matchMinutes || 0)} min, total ${totalExposureMinutes} min`,
        };
      }),
    };
  });

  return {
    weeks: weeks.map((week) => ({
      weekStart: week.weekStart,
      dateFrom: week.dateFrom,
      dateTo: week.dateTo,
      label: formatWeekLabel(week),
    })),
    maxExposure,
    rows,
  };
}

function calculateAverage(values = []) {
  if (!values.length) {
    return 0;
  }
  return Math.round((values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) * 10) / 10;
}

function findPlayerInRoster(roster = [], playerId) {
  return roster.find((player) => String(player.player_id || player.id) === String(playerId)) || null;
}

function formatPlayerName(player = {}) {
  return `${player.first_name || ''} ${player.last_name || ''}`.trim();
}

function createEmptyExposureComposition() {
  return buildExposureComposition(0, 0);
}

function normalizeWindowPlayer(windowSummary, playerId) {
  const player = windowSummary && Array.isArray(windowSummary.players)
    ? windowSummary.players.find((entry) => String(entry.playerId) === String(playerId))
    : null;

  return player ? player.composition : createEmptyExposureComposition();
}

function calculateDaysBetween(dateFrom, dateTo) {
  const from = parseIsoDateToUtc(dateFrom);
  const to = parseIsoDateToUtc(dateTo);
  if (!from || !to) {
    return null;
  }
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

function buildPlayerCompetitionSummary(playerId, activities = [], entries = []) {
  const doneMatchActivities = activities.filter((activity) => (
    activity.activity_type === 'MATCH' && isDoneActivity(activity)
  ));
  const matchActivityIds = new Set(doneMatchActivities.map((activity) => String(activity.id)));
  const playerMatchEntries = entries.filter((entry) => (
    String(entry.player_id) === String(playerId)
    && matchActivityIds.has(String(entry.activity_id))
  ));
  const totalMatchMinutes = playerMatchEntries
    .filter((entry) => entry.attended)
    .reduce((sum, entry) => sum + Number(entry.exposure_minutes || 0), 0);
  const matchesWithParticipation = playerMatchEntries
    .filter((entry) => entry.attended && Number(entry.exposure_minutes || 0) > 0)
    .length;

  return {
    totalMatchMinutes,
    matchesWithParticipation,
    registeredMatches: doneMatchActivities.length,
    averageMinutesPerParticipatedMatch: matchesWithParticipation > 0
      ? Math.round((totalMatchMinutes / matchesWithParticipation) * 10) / 10
      : null,
  };
}

function buildPlayerTrainingSummary(playerId, activities = [], entries = []) {
  const doneTrainingActivities = activities
    .filter((activity) => activity.activity_type === 'TRAINING' && isDoneActivity(activity))
    .sort((a, b) => toIsoDate(a.activity_date).localeCompare(toIsoDate(b.activity_date)));
  const trainingActivityIds = new Set(doneTrainingActivities.map((activity) => String(activity.id)));
  const activityById = new Map(doneTrainingActivities.map((activity) => [String(activity.id), activity]));
  const playerTrainingEntries = entries
    .filter((entry) => String(entry.player_id) === String(playerId) && trainingActivityIds.has(String(entry.activity_id)));
  const attendedSessions = playerTrainingEntries.filter((entry) => entry.attended).length;
  const availableSessions = doneTrainingActivities.length;
  const accumulatedMinutes = playerTrainingEntries
    .filter((entry) => entry.attended)
    .reduce((sum, entry) => sum + Number(entry.exposure_minutes || 0), 0);
  const entryByActivityId = new Map(playerTrainingEntries.map((entry) => [String(entry.activity_id), entry]));
  const latestSessions = doneTrainingActivities
    .slice()
    .sort((a, b) => toIsoDate(b.activity_date).localeCompare(toIsoDate(a.activity_date)))
    .slice(0, 5)
    .map((activity) => {
      const entry = entryByActivityId.get(String(activity.id));
      return {
        date: toIsoDate(activity.activity_date),
        title: activity.title,
        attended: Boolean(entry && entry.attended),
        attendanceLabel: entry && entry.attended ? 'Asistido' : 'No asistido',
        minutes: entry && entry.attended ? Number(entry.exposure_minutes || 0) : 0,
        activityId: activity.id,
      };
    });

  return {
    attendedSessions,
    availableSessions,
    attendancePercentage: availableSessions > 0
      ? Math.round((attendedSessions / availableSessions) * 1000) / 10
      : null,
    accumulatedMinutes,
    latestSessions,
    activityById,
  };
}

function buildPlayerContinuity(playerId, activities = [], entries = [], referenceDate = new Date()) {
  const playerEntries = entries.filter((entry) => String(entry.player_id) === String(playerId));
  const lastActivityEntry = playerEntries
    .filter((entry) => isEntryDoneAndAttended(entry))
    .sort((a, b) => toIsoDate(b.activity_date).localeCompare(toIsoDate(a.activity_date)))[0] || null;
  const doneTrainings = activities
    .filter((activity) => activity.activity_type === 'TRAINING' && isDoneActivity(activity))
    .sort((a, b) => toIsoDate(b.activity_date).localeCompare(toIsoDate(a.activity_date)));
  const entryByActivityId = new Map(playerEntries.map((entry) => [String(entry.activity_id), entry]));
  let consecutiveTrainingAttended = 0;
  let consecutiveTrainingMissed = 0;
  let streakMode = null;

  doneTrainings.forEach((activity) => {
    if (streakMode === 'closed') {
      return;
    }
    const entry = entryByActivityId.get(String(activity.id));
    const attended = Boolean(entry && entry.attended);
    if (streakMode === null) {
      streakMode = attended ? 'attended' : 'missed';
    }
    if (streakMode === 'attended' && attended) {
      consecutiveTrainingAttended += 1;
      return;
    }
    if (streakMode === 'missed' && !attended) {
      consecutiveTrainingMissed += 1;
      return;
    }
    streakMode = 'closed';
  });

  const lastActivityDate = lastActivityEntry ? toIsoDate(lastActivityEntry.activity_date) : null;

  return {
    lastActivityDate,
    daysSinceLastActivity: lastActivityDate
      ? calculateDaysBetween(lastActivityDate, referenceDate)
      : null,
    consecutiveTrainingAttended,
    consecutiveTrainingMissed,
  };
}

function buildPlayerActivityHistory(playerId, activities = [], entries = []) {
  const activityById = new Map(activities.map((activity) => [String(activity.id), activity]));
  return entries
    .filter((entry) => String(entry.player_id) === String(playerId))
    .map((entry) => {
      const activity = activityById.get(String(entry.activity_id)) || {};
      let attendanceLabel = entry.attended ? 'Asistido' : 'No asistido';
      if (activity.status === 'planned') {
        attendanceLabel = 'Planificada';
      } else if (activity.status === 'cancelled') {
        attendanceLabel = 'Cancelada';
      }

      return {
        date: toIsoDate(entry.activity_date || activity.activity_date),
        type: entry.activity_type || activity.activity_type,
        title: activity.title || '',
        attendanceLabel,
        attended: Boolean(entry.attended),
        minutes: isDoneActivity(activity) && entry.attended ? Number(entry.exposure_minutes || 0) : 0,
        status: activity.status || entry.status || 'done',
        activityId: entry.activity_id,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function buildPlayerAnalyticalDetail({
  selectedPlayerId,
  roster = [],
  activities = [],
  entries = [],
  windows = {},
  weeklyEvolution = {},
  personalHistory = [],
  selectedTeam = null,
  activeSeason = null,
  referenceDate = new Date(),
} = {}) {
  if (!selectedPlayerId) {
    return null;
  }

  const rosterPlayer = findPlayerInRoster(roster, selectedPlayerId);
  if (!rosterPlayer) {
    return null;
  }

  const playerId = Number(rosterPlayer.player_id || rosterPlayer.id);
  const weeklyPlayer = (weeklyEvolution.players || [])
    .find((player) => String(player.playerId) === String(playerId)) || null;
  const history = personalHistory.find((entry) => String(entry.playerId) === String(playerId)) || null;
  const training = buildPlayerTrainingSummary(playerId, activities, entries);
  const identity = {
    playerId,
    fullName: formatPlayerName(rosterPlayer),
    dorsal: rosterPlayer.dorsal || '',
    positions: rosterPlayer.positions || '',
    teamName: selectedTeam ? selectedTeam.name : rosterPlayer.team_name,
    seasonName: activeSeason ? activeSeason.name : '',
  };

  return {
    identification: identity,
    player: identity,
    exposure: {
      sevenDays: normalizeWindowPlayer(windows.sevenDays, playerId),
      twentyEightDays: normalizeWindowPlayer(windows.twentyEightDays, playerId),
      season: normalizeWindowPlayer(windows.season, playerId),
    },
    personalHistory: history,
    weeklyEvolution: weeklyPlayer ? weeklyPlayer.weeks : [],
    evolution: weeklyPlayer ? weeklyPlayer.weeks.map((week) => ({
      date: week.weekStart,
      trainingMinutes: week.trainingMinutes,
      matchMinutes: week.matchMinutes,
      totalExposureMinutes: week.totalExposureMinutes,
    })) : [],
    competition: buildPlayerCompetitionSummary(playerId, activities, entries),
    trainings: {
      attendedSessions: training.attendedSessions,
      availableSessions: training.availableSessions,
      attendancePercentage: training.attendancePercentage,
      accumulatedMinutes: training.accumulatedMinutes,
      latestSessions: training.latestSessions,
    },
    continuity: buildPlayerContinuity(playerId, activities, entries, referenceDate),
    activityHistory: buildPlayerActivityHistory(playerId, activities, entries),
  };
}

function buildPersonalHistory(roster = [], entries = [], referenceDate = new Date()) {
  const currentWeek = buildWeekWindow(startOfWeek(referenceDate));
  const previousWeek = buildWeekWindow(addDays(currentWeek.weekStart, -7));
  const fourPreviousWeeks = Array.from({ length: 4 }, (_value, index) => (
    buildWeekWindow(addDays(currentWeek.weekStart, -7 * (index + 1)))
  )).reverse();
  const firstEntryDate = entries.reduce((earliest, entry) => {
    if (!isEntryDoneAndAttended(entry)) {
      return earliest;
    }
    const isoDate = toIsoDate(entry.activity_date);
    if (!isoDate) {
      return earliest;
    }
    return !earliest || isoDate < earliest ? isoDate : earliest;
  }, null);
  const seasonStart = firstEntryDate ? startOfWeek(firstEntryDate) : currentWeek.weekStart;
  const seasonWeeks = [];
  for (let weekStart = seasonStart; weekStart <= currentWeek.weekStart; weekStart = addDays(weekStart, 7)) {
    seasonWeeks.push(buildWeekWindow(weekStart));
  }

  const historyWeeks = buildWeeklyEvolution(roster, entries, currentWeek.dateTo, seasonWeeks.length || 1);
  const playersById = new Map(historyWeeks.players.map((player) => [String(player.playerId), player]));

  return roster.map((player) => {
    const playerId = Number(player.player_id || player.id);
    const weekly = playersById.get(String(playerId));
    const weeklyBuckets = weekly ? weekly.weeks : [];
    const currentBucket = weeklyBuckets.find((week) => week.weekStart === currentWeek.weekStart)
      || buildEmptyWeeklyBucket(currentWeek);
    const previousBucket = weeklyBuckets.find((week) => week.weekStart === previousWeek.weekStart)
      || buildEmptyWeeklyBucket(previousWeek);
    const previousFourValues = fourPreviousWeeks.map((week) => {
      const bucket = weeklyBuckets.find((item) => item.weekStart === week.weekStart);
      return bucket ? bucket.totalExposureMinutes : 0;
    });
    const previousFourAverage = calculateAverage(previousFourValues);
    const seasonValuesWithActivity = weeklyBuckets
      .map((week) => Number(week.totalExposureMinutes || 0))
      .filter((value) => value > 0);
    const differenceFromAverage = currentBucket.totalExposureMinutes - previousFourAverage;

    return {
      playerId,
      currentWeekExposure: currentBucket.totalExposureMinutes,
      previousWeekExposure: previousBucket.totalExposureMinutes,
      previousFourCompleteWeeksAverage: previousFourAverage,
      differenceFromFourWeekAverage: differenceFromAverage,
      percentageDifferenceFromFourWeekAverage: previousFourAverage > 0
        ? Math.round((differenceFromAverage / previousFourAverage) * 1000) / 10
        : null,
      seasonMaxWeeklyExposure: seasonValuesWithActivity.length ? Math.max(...seasonValuesWithActivity) : 0,
      seasonMinWeeklyExposureWithActivity: seasonValuesWithActivity.length ? Math.min(...seasonValuesWithActivity) : 0,
      trend: buildDeterministicTrend(currentBucket.totalExposureMinutes, previousBucket.totalExposureMinutes),
    };
  });
}

module.exports = {
  WINDOW_DEFINITIONS,
  toIsoDate,
  addDays,
  startOfWeek,
  buildMetricWindows,
  buildWeeklyWindows,
  calculateExposureForPeriod,
  calculateTeamAverage,
  decorateComparisons,
  buildTemporalEvolution,
  buildExposureComposition,
  buildWeeklyEvolution,
  buildExposureMap,
  buildPersonalHistory,
  buildPlayerAnalyticalDetail,
  buildDeterministicTrend,
};
