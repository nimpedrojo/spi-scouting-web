const CONTEXT_SCHEMA_VERSION = 'player-load-context/v1';

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOneDecimal(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed * 10) / 10;
}

function buildPeriod(window, key) {
  if (!window) {
    return {
      key,
      label: key,
      dateFrom: null,
      dateTo: null,
    };
  }

  return {
    key: window.key || key,
    label: window.label || key,
    dateFrom: window.dateFrom || null,
    dateTo: window.dateTo || null,
  };
}

function buildPreviousPeriod(variation = {}) {
  const training = variation.trainingMinutes || {};
  const match = variation.matchMinutes || {};
  const total = variation.totalExposureMinutes || {};

  return {
    trainingMinutesDelta: numberOrZero(training.absolute),
    trainingMinutesPercentageDelta: nullableNumber(training.percentage),
    matchMinutesDelta: numberOrZero(match.absolute),
    matchMinutesPercentageDelta: nullableNumber(match.percentage),
    totalExposureMinutesDelta: numberOrZero(total.absolute),
    totalExposurePercentageDelta: nullableNumber(total.percentage),
  };
}

function buildTeamComparison(teamAverageDifference = {}) {
  return {
    trainingMinutesDifferenceFromAverage: roundOneDecimal(teamAverageDifference.trainingMinutes) || 0,
    matchMinutesDifferenceFromAverage: roundOneDecimal(teamAverageDifference.matchMinutes) || 0,
    totalExposureMinutesDifferenceFromAverage: roundOneDecimal(teamAverageDifference.totalExposureMinutes) || 0,
    totalExposurePercentageDifferenceFromAverage: nullableNumber(teamAverageDifference.totalExposurePercentage),
  };
}

function buildTrend(previousPeriod) {
  const delta = numberOrZero(previousPeriod.totalExposureMinutesDelta);
  let direction = 'flat';

  if (delta > 0) {
    direction = 'up';
  } else if (delta < 0) {
    direction = 'down';
  }

  return {
    direction,
    totalExposureMinutesDelta: delta,
    totalExposurePercentageDelta: nullableNumber(previousPeriod.totalExposurePercentageDelta),
  };
}

function buildPlayerIdentity(player = {}) {
  return {
    id: Number(player.playerId || player.player_id || player.id),
    fullName: player.fullName || `${player.first_name || ''} ${player.last_name || ''}`.trim(),
    dorsal: player.dorsal || '',
    positions: player.positions || '',
  };
}

function buildPlayerContext(player, period, selectedPlayerDetail = null) {
  const previousPeriod = buildPreviousPeriod(player.previousPeriodVariation);
  const teamComparison = buildTeamComparison(player.teamAverageDifference);
  const playerId = Number(player.playerId || player.player_id || player.id);
  const isSelectedDetail = selectedPlayerDetail
    && selectedPlayerDetail.player
    && Number(selectedPlayerDetail.player.playerId) === playerId;

  return {
    player: buildPlayerIdentity(player),
    period,
    training: {
      sessions: numberOrZero(player.trainingSessions),
      availableSessions: numberOrZero(player.availableTrainingSessions),
      attendancePercentage: nullableNumber(player.attendancePercentage),
      minutes: numberOrZero(player.trainingMinutes),
    },
    matches: {
      minutes: numberOrZero(player.matchMinutes),
    },
    exposure: {
      totalMinutes: numberOrZero(player.totalExposureMinutes),
      formula: 'trainingMinutes + matchMinutes',
    },
    previousPeriod,
    teamComparison,
    trend: buildTrend(previousPeriod),
    evolution: isSelectedDetail && Array.isArray(selectedPlayerDetail.evolution)
      ? selectedPlayerDetail.evolution.map((entry) => ({
        date: entry.date,
        trainingMinutes: numberOrZero(entry.trainingMinutes),
        matchMinutes: numberOrZero(entry.matchMinutes),
        totalExposureMinutes: numberOrZero(entry.totalExposureMinutes),
      }))
      : [],
  };
}

function summarizePlayerContext(playerContext) {
  return {
    player: playerContext.player,
    training: playerContext.training,
    matches: playerContext.matches,
    exposure: playerContext.exposure,
    previousPeriod: playerContext.previousPeriod,
    teamComparison: playerContext.teamComparison,
    trend: playerContext.trend,
  };
}

function buildRanking(players, rankValueKey, valueSelector, direction = 'desc', limit = 10) {
  const multiplier = direction === 'asc' ? 1 : -1;

  return players
    .map((player) => ({
      player: player.player,
      [rankValueKey]: valueSelector(player),
    }))
    .sort((a, b) => {
      const first = numberOrZero(a[rankValueKey]);
      const second = numberOrZero(b[rankValueKey]);
      if (first === second) {
        return a.player.fullName.localeCompare(b.player.fullName);
      }
      return (first - second) * multiplier;
    })
    .slice(0, limit);
}

function buildRankings(players, limit) {
  return {
    highestExposure: buildRanking(
      players,
      'totalExposureMinutes',
      (player) => player.exposure.totalMinutes,
      'desc',
      limit,
    ),
    largestExposureIncrease: buildRanking(
      players,
      'totalExposureMinutesDelta',
      (player) => player.previousPeriod.totalExposureMinutesDelta,
      'desc',
      limit,
    ),
    lowestMatchMinutes: buildRanking(
      players,
      'matchMinutes',
      (player) => player.matches.minutes,
      'asc',
      limit,
    ),
  };
}

function buildPlayerComparison(players, playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    return null;
  }

  const byId = new Map(players.map((player) => [String(player.player.id), player]));
  const selectedPlayers = playerIds
    .map((playerId) => byId.get(String(playerId)))
    .filter(Boolean)
    .slice(0, 2);

  if (selectedPlayers.length < 2) {
    return null;
  }

  const [first, second] = selectedPlayers;

  return {
    players: selectedPlayers.map(summarizePlayerContext),
    deltas: {
      firstMinusSecond: {
        trainingMinutes: first.training.minutes - second.training.minutes,
        matchMinutes: first.matches.minutes - second.matches.minutes,
        totalExposureMinutes: first.exposure.totalMinutes - second.exposure.totalMinutes,
        attendancePercentage: first.training.attendancePercentage === null
          || second.training.attendancePercentage === null
          ? null
          : roundOneDecimal(first.training.attendancePercentage - second.training.attendancePercentage),
      },
    },
  };
}

function buildTeamBlock(playerLoad, selectedWindow, players) {
  return {
    id: playerLoad.selectedTeam ? playerLoad.selectedTeam.id : null,
    name: playerLoad.selectedTeam ? playerLoad.selectedTeam.name : null,
    rosterCount: Array.isArray(playerLoad.roster) ? playerLoad.roster.length : players.length,
    summary: playerLoad.teamSummary || {
      totalExposureMinutes: 0,
      averageExposureMinutes: 0,
      averageAttendancePercentage: null,
      matchMinutes: 0,
      distribution: [],
    },
    average: selectedWindow && selectedWindow.teamAverage ? selectedWindow.teamAverage : null,
    evolution: selectedWindow && Array.isArray(selectedWindow.evolution)
      ? selectedWindow.evolution.map((entry) => ({
        date: entry.date,
        trainingMinutes: numberOrZero(entry.trainingMinutes),
        matchMinutes: numberOrZero(entry.matchMinutes),
        totalExposureMinutes: numberOrZero(entry.totalExposureMinutes),
      }))
      : [],
  };
}

function buildPlayerLoadContext(playerLoad, options = {}) {
  const periodKey = options.periodKey || playerLoad.selectedPeriod || 'sevenDays';
  const selectedWindow = playerLoad.windows && playerLoad.windows[periodKey]
    ? playerLoad.windows[periodKey]
    : playerLoad.selectedWindow;
  const period = buildPeriod(selectedWindow, periodKey);
  const players = selectedWindow && Array.isArray(selectedWindow.players)
    ? selectedWindow.players.map((player) => buildPlayerContext(player, period, playerLoad.playerDetail))
    : [];
  const playerComparison = buildPlayerComparison(players, options.playerIds);

  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    domain: {
      metricType: 'observed_exposure',
      calculationOwner: 'backend',
      totalExposureFormula: 'trainingMinutes + matchMinutes',
      consumerBoundary: 'Downstream narrative services must use these precomputed metrics and must not recalculate them.',
      description: playerLoad.exposureDefinition || 'Observed exposure in training and match minutes.',
    },
    scope: {
      clubId: playerLoad.club ? playerLoad.club.id : null,
      clubName: playerLoad.club ? playerLoad.club.name : null,
      seasonId: playerLoad.activeSeason ? playerLoad.activeSeason.id : null,
      seasonName: playerLoad.activeSeason ? playerLoad.activeSeason.name : null,
      teamId: playerLoad.selectedTeam ? playerLoad.selectedTeam.id : null,
      teamName: playerLoad.selectedTeam ? playerLoad.selectedTeam.name : null,
    },
    period,
    team: buildTeamBlock(playerLoad, selectedWindow, players),
    players,
    rankings: buildRankings(players, options.rankingLimit || 10),
    comparisons: playerComparison ? [playerComparison] : [],
  };
}

module.exports = {
  CONTEXT_SCHEMA_VERSION,
  buildPlayerLoadContext,
};
