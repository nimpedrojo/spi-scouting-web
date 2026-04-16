const { AREA_KEYS, getTeamBenchmark } = require('./teamBenchmarkService');
const { getAreaLabel } = require('./evaluationAreaHelper');

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildNarrative(areaComparisons) {
  const aboveAreas = areaComparisons.filter((entry) => entry.difference > 0.15);
  const belowAreas = areaComparisons.filter((entry) => entry.difference < -0.15);

  return {
    strengthsText: aboveAreas.length
      ? `El jugador se sitúa por encima de la media del equipo en ${aboveAreas.map((entry) => entry.label.toLowerCase()).join(', ')}.`
      : '',
    improvementText: belowAreas.length
      ? `Necesita mejorar respecto al grupo en ${belowAreas.map((entry) => entry.label.toLowerCase()).join(', ')}.`
      : '',
  };
}

async function getPlayerBenchmark(playerId, teamId, clubId, seasonId) {
  const teamBenchmark = await getTeamBenchmark(teamId, clubId, seasonId);
  const teamPlayer = teamBenchmark.playerBenchmarks
    ? teamBenchmark.playerBenchmarks.find((player) => String(player.playerId) === String(playerId))
    : null;

  if (!teamPlayer) {
    return {
      isReady: false,
      playerHasEvaluations: false,
      message: 'Aún no hay suficientes evaluaciones para comparar al jugador con su equipo.',
      teamBenchmark,
    };
  }

  if (!teamBenchmark.isReady) {
    return {
      isReady: false,
      playerHasEvaluations: true,
      message: 'Aún no hay suficientes evaluaciones para comparar al jugador con su equipo.',
      teamBenchmark,
      playerGlobalAverage: teamPlayer.globalAverage,
      playerAreaEntries: teamPlayer.areaEntries,
    };
  }

  const areaComparisons = AREA_KEYS.map((areaKey) => {
    const playerAverage = teamPlayer.areaAverages[areaKey];
    const teamAverage = teamBenchmark.teamAreaAverages[areaKey];
    const difference = playerAverage != null && teamAverage != null
      ? roundScore(playerAverage - teamAverage)
      : null;

    return {
      key: areaKey,
      label: getAreaLabel(areaKey),
      playerAverage,
      teamAverage,
      difference,
    };
  });

  const globalDifference = teamPlayer.globalAverage != null && teamBenchmark.globalAverage != null
    ? roundScore(teamPlayer.globalAverage - teamBenchmark.globalAverage)
    : null;
  const narrative = buildNarrative(areaComparisons.filter((entry) => entry.difference != null));

  return {
    isReady: true,
    playerHasEvaluations: true,
    message: '',
    teamBenchmark,
    playerGlobalAverage: teamPlayer.globalAverage,
    teamGlobalAverage: teamBenchmark.globalAverage,
    globalDifference,
    playerAreaEntries: teamPlayer.areaEntries,
    areaComparisons,
    strengthsText: narrative.strengthsText,
    improvementText: narrative.improvementText,
  };
}

module.exports = {
  getPlayerBenchmark,
};
