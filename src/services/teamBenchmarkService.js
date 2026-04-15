const db = require('../db');
const { getPlayersByTeamId } = require('../models/teamPlayerModel');
const { getAreaLabel } = require('./evaluationAreaHelper');

const AREA_KEYS = ['tecnica', 'tactica', 'fisica', 'psicologica', 'personalidad'];
const MIN_EVALUATED_PLAYERS = 3;
const MAX_EVALUATIONS_PER_PLAYER = 3;

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildAreaEntries(areaAverages) {
  return AREA_KEYS.map((areaKey) => ({
    key: areaKey,
    label: getAreaLabel(areaKey),
    average: areaAverages[areaKey] != null ? roundScore(areaAverages[areaKey]) : null,
  }));
}

function calculateGlobalAverage(areaAverages) {
  const values = AREA_KEYS
    .map((areaKey) => areaAverages[areaKey])
    .filter((value) => value != null);

  if (!values.length) {
    return null;
  }

  return roundScore(values.reduce((sum, value) => sum + Number(value), 0) / values.length);
}

function summarizeNarrative(areaEntries) {
  const availableEntries = areaEntries.filter((entry) => entry.average != null);
  if (!availableEntries.length) {
    return {
      strongestAreaText: '',
      improvementAreaText: '',
    };
  }

  const strongestArea = [...availableEntries].sort((a, b) => b.average - a.average)[0];
  const improvementArea = [...availableEntries].sort((a, b) => a.average - b.average)[0];

  return {
    strongestAreaText: `El equipo presenta mejor valoración media en ${strongestArea.label.toLowerCase()}.`,
    improvementAreaText: `El área ${improvementArea.label.toLowerCase()} muestra más margen de mejora.`,
  };
}

function buildInsightLists(playerBenchmarks, teamGlobalAverage) {
  if (teamGlobalAverage == null) {
    return {
      aboveAveragePlayers: [],
      improvementPlayers: [],
    };
  }

  const comparablePlayers = playerBenchmarks
    .filter((player) => player.globalAverage != null)
    .map((player) => ({
      playerId: player.playerId,
      fullName: player.fullName,
      globalAverage: player.globalAverage,
      difference: roundScore(player.globalAverage - teamGlobalAverage),
    }));

  return {
    aboveAveragePlayers: comparablePlayers
      .filter((player) => player.difference > 0)
      .sort((a, b) => b.difference - a.difference || a.fullName.localeCompare(b.fullName))
      .slice(0, 3),
    improvementPlayers: comparablePlayers
      .filter((player) => player.difference < 0)
      .sort((a, b) => a.difference - b.difference || a.fullName.localeCompare(b.fullName))
      .slice(0, 3),
  };
}

function buildPlayerBenchmark(teamPlayer, evaluations) {
  if (!teamPlayer || !Array.isArray(evaluations) || !evaluations.length) {
    return null;
  }

  const areaBuckets = {};
  AREA_KEYS.forEach((areaKey) => {
    areaBuckets[areaKey] = [];
  });

  evaluations.forEach((evaluation) => {
    AREA_KEYS.forEach((areaKey) => {
      if (evaluation.areaAverages[areaKey] != null) {
        areaBuckets[areaKey].push(Number(evaluation.areaAverages[areaKey]));
      }
    });
  });

  const areaAverages = {};
  AREA_KEYS.forEach((areaKey) => {
    if (!areaBuckets[areaKey].length) {
      areaAverages[areaKey] = null;
      return;
    }

    areaAverages[areaKey] = roundScore(
      areaBuckets[areaKey].reduce((sum, value) => sum + value, 0) / areaBuckets[areaKey].length,
    );
  });

  return {
    playerId: teamPlayer.player_id,
    fullName: `${teamPlayer.first_name} ${teamPlayer.last_name}`.trim(),
    dorsal: teamPlayer.dorsal || '',
    evaluationCount: evaluations.length,
    latestEvaluationDate: evaluations[0].evaluationDate,
    areaAverages,
    areaEntries: buildAreaEntries(areaAverages),
    globalAverage: calculateGlobalAverage(areaAverages),
  };
}

async function getScopedEvaluationRows(clubId, teamId, seasonId, playerIds) {
  if (!clubId || !teamId || !seasonId || !playerIds.length) {
    return [];
  }

  const placeholders = playerIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT
        e.id AS evaluation_id,
        e.player_id,
        e.evaluation_date,
        e.created_at,
        es.area,
        es.score
      FROM evaluations e
      INNER JOIN evaluation_scores es ON es.evaluation_id = e.id
      WHERE e.club_id = ?
        AND e.team_id = ?
        AND e.season_id = ?
        AND e.player_id IN (${placeholders})
      ORDER BY e.player_id ASC, e.evaluation_date DESC, e.created_at DESC, es.area ASC, es.sort_order ASC`,
    [clubId, teamId, seasonId, ...playerIds],
  );

  return rows;
}

function buildEvaluationsByPlayer(rows) {
  const playersMap = new Map();

  rows.forEach((row) => {
    const playerKey = String(row.player_id);
    if (!playersMap.has(playerKey)) {
      playersMap.set(playerKey, new Map());
    }

    const evaluationsMap = playersMap.get(playerKey);
    const evaluationKey = String(row.evaluation_id);
    if (!evaluationsMap.has(evaluationKey)) {
      evaluationsMap.set(evaluationKey, {
        evaluationId: row.evaluation_id,
        evaluationDate: row.evaluation_date,
        createdAt: row.created_at,
        areaBuckets: {},
      });
    }

    const evaluation = evaluationsMap.get(evaluationKey);
    if (!evaluation.areaBuckets[row.area]) {
      evaluation.areaBuckets[row.area] = [];
    }
    evaluation.areaBuckets[row.area].push(Number(row.score));
  });

  const normalized = new Map();
  playersMap.forEach((evaluationsMap, playerKey) => {
    const evaluations = Array.from(evaluationsMap.values())
      .map((evaluation) => {
        const areaAverages = {};
        AREA_KEYS.forEach((areaKey) => {
          const scores = evaluation.areaBuckets[areaKey] || [];
          areaAverages[areaKey] = scores.length
            ? roundScore(scores.reduce((sum, score) => sum + score, 0) / scores.length)
            : null;
        });

        return {
          evaluationId: evaluation.evaluationId,
          evaluationDate: evaluation.evaluationDate,
          createdAt: evaluation.createdAt,
          areaAverages,
        };
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.evaluationDate) - new Date(a.evaluationDate);
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .slice(0, MAX_EVALUATIONS_PER_PLAYER);

    normalized.set(playerKey, evaluations);
  });

  return normalized;
}

async function getTeamBenchmark(teamId, clubId, seasonId) {
  if (!teamId || !clubId || !seasonId) {
    return {
      isReady: false,
      minimumEvaluatedPlayers: MIN_EVALUATED_PLAYERS,
      message: 'Aún no hay suficientes evaluaciones para mostrar una visión útil del equipo.',
    };
  }

  const teamPlayers = await getPlayersByTeamId(teamId);
  const playerIds = teamPlayers.map((player) => player.player_id);
  const evaluationRows = await getScopedEvaluationRows(clubId, teamId, seasonId, playerIds);
  const evaluationsByPlayer = buildEvaluationsByPlayer(evaluationRows);

  const playerBenchmarks = teamPlayers
    .map((teamPlayer) => buildPlayerBenchmark(teamPlayer, evaluationsByPlayer.get(String(teamPlayer.player_id)) || []))
    .filter(Boolean);

  const evaluatedPlayers = playerBenchmarks.filter((player) => player.evaluationCount > 0);
  const evaluationsConsidered = evaluatedPlayers.reduce((sum, player) => sum + player.evaluationCount, 0);
  const lastEvaluationDate = evaluatedPlayers.reduce((latest, player) => {
    if (!player.latestEvaluationDate) {
      return latest;
    }
    if (!latest) {
      return player.latestEvaluationDate;
    }
    return new Date(player.latestEvaluationDate) > new Date(latest) ? player.latestEvaluationDate : latest;
  }, null);

  const teamAreaAverages = {};
  AREA_KEYS.forEach((areaKey) => {
    const values = evaluatedPlayers
      .map((player) => player.areaAverages[areaKey])
      .filter((value) => value != null);
    teamAreaAverages[areaKey] = values.length
      ? roundScore(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  });

  const globalAverage = calculateGlobalAverage(teamAreaAverages);
  const areaEntries = buildAreaEntries(teamAreaAverages);
  const narratives = summarizeNarrative(areaEntries);
  const insightLists = buildInsightLists(evaluatedPlayers, globalAverage);
  const isReady = evaluatedPlayers.length >= MIN_EVALUATED_PLAYERS;

  return {
    isReady,
    minimumEvaluatedPlayers: MIN_EVALUATED_PLAYERS,
    totalPlayers: teamPlayers.length,
    evaluatedPlayersCount: evaluatedPlayers.length,
    evaluationsConsideredCount: evaluationsConsidered,
    lastEvaluationDate,
    teamAreaAverages,
    areaEntries,
    globalAverage,
    playerBenchmarks: evaluatedPlayers,
    strongestAreaText: narratives.strongestAreaText,
    improvementAreaText: narratives.improvementAreaText,
    aboveAveragePlayers: insightLists.aboveAveragePlayers,
    improvementPlayers: insightLists.improvementPlayers,
    message: isReady
      ? ''
      : 'Aún no hay suficientes evaluaciones para mostrar una visión útil del equipo.',
  };
}

module.exports = {
  AREA_KEYS,
  MIN_EVALUATED_PLAYERS,
  MAX_EVALUATIONS_PER_PLAYER,
  getTeamBenchmark,
};
