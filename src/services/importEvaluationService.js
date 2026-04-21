const XLSX = require('xlsx');
const { getAllPlayers } = require('../models/playerModel');
const { getTeamsByClubId } = require('../models/teamModel');
const { requireClubForUser, getActiveSeasonByClub } = require('./teamService');
const { createEvaluationWithScores } = require('./evaluationService');
const { EVALUATION_TEMPLATE } = require('./evaluationTemplate');

const BASE_HEADERS = [
  'team_name',
  'player_name',
  'evaluation_date',
  'source',
  'title',
  'notes',
];

function buildMetricHeaderMap() {
  const map = {};
  EVALUATION_TEMPLATE.forEach((area) => {
    area.metrics.forEach((metric) => {
      map[`${area.key}_${metric.key}`] = {
        area: area.key,
        metricKey: metric.key,
      };
    });
  });
  return map;
}

function getWorkbookHeaders() {
  return [
    ...BASE_HEADERS,
    ...Object.keys(buildMetricHeaderMap()),
  ];
}

function formatWorkbookDate(value) {
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

function parseWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
}

function buildWorkbookBufferFromRows(rows) {
  const headers = getWorkbookHeaders();
  const dataRows = Array.isArray(rows)
    ? rows.map((row) => headers.map((header) => (row[header] === undefined ? '' : row[header])))
    : [];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Evaluaciones');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function buildWorkbookRowsFromEvaluations(evaluations, scoresByEvaluationId = new Map()) {
  const metricHeaderMap = buildMetricHeaderMap();

  return (evaluations || []).map((evaluation) => {
    const row = {
      team_name: evaluation.team_name || '',
      player_name: `${evaluation.first_name || ''} ${evaluation.last_name || ''}`.trim(),
      evaluation_date: formatWorkbookDate(evaluation.evaluation_date),
      source: evaluation.source || 'manual',
      title: evaluation.title || '',
      notes: evaluation.notes || '',
    };

    Object.keys(metricHeaderMap).forEach((header) => {
      row[header] = '';
    });

    const scoreEntries = scoresByEvaluationId.get(evaluation.id) || [];
    scoreEntries.forEach((score) => {
      const header = `${score.area}_${score.metric_key}`;
      if (Object.prototype.hasOwnProperty.call(row, header)) {
        row[header] = Number(score.score);
      }
    });

    return row;
  });
}

async function importEvaluationsFromWorkbook(user, buffer, options = {}) {
  const club = await requireClubForUser(user);
  if (!club) {
    return {
      created: 0,
      skipped: 0,
      errors: [{ row: 0, message: 'Debes tener un club activo para importar evaluaciones.' }],
    };
  }

  const [rows, teams, players, activeSeason] = await Promise.all([
    Promise.resolve(parseWorkbookRows(buffer)),
    getTeamsByClubId(club.id),
    getAllPlayers(club.name),
    getActiveSeasonByClub(club.id),
  ]);

  const metricHeaderMap = buildMetricHeaderMap();
  const teamByName = new Map(teams.map((team) => [team.name.toLowerCase(), team]));
  const playerByName = new Map(
    players.map((player) => [`${player.first_name} ${player.last_name}`.trim().toLowerCase(), player]),
  );

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const [index, row] of rows.entries()) {
    const teamName = String(row.team_name || row.team || '').trim();
    const playerName = String(row.player_name || '').trim();
    const team = teamByName.get(teamName.toLowerCase());
    const player = playerByName.get(playerName.toLowerCase());

    if (!teamName || !playerName) {
      skipped += 1;
      errors.push({ row: index + 2, message: 'Fila incompleta: team_name y player_name son obligatorios.' });
      continue;
    }
    if (!team) {
      skipped += 1;
      errors.push({ row: index + 2, message: `Equipo no encontrado: ${teamName}.` });
      continue;
    }
    if (!player) {
      skipped += 1;
      errors.push({ row: index + 2, message: `Jugador no encontrado: ${playerName}.` });
      continue;
    }

    const groupedScores = {};
    Object.entries(metricHeaderMap).forEach(([header, definition]) => {
      if (!groupedScores[definition.area]) {
        groupedScores[definition.area] = {};
      }
      groupedScores[definition.area][definition.metricKey] = row[header];
    });

    const payload = {
      seasonId: activeSeason ? activeSeason.id : team.season_id,
      teamId: team.id,
      playerId: player.id,
      evaluationDate: row.evaluation_date instanceof Date
        ? row.evaluation_date.toISOString().slice(0, 10)
        : String(row.evaluation_date || '').slice(0, 10),
      source: row.source || 'excel',
      title: row.title || null,
      notes: row.notes || null,
      groupedScores,
    };

    const result = await createEvaluationWithScores(user, payload, {
      dryRun: Boolean(options.dryRun),
    });
    if (result.errors && result.errors.length) {
      skipped += 1;
      errors.push({ row: index + 2, message: result.errors.join(' ') });
      continue;
    }
    created += 1;
  }

  return {
    created,
    skipped,
    errors,
  };
}

module.exports = {
  buildWorkbookBufferFromRows,
  buildWorkbookRowsFromEvaluations,
  getWorkbookHeaders,
  importEvaluationsFromWorkbook,
};
