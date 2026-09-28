const XLSX = require('xlsx');

function normalizeText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function decodeCsvBuffer(buffer) {
  const sample = buffer.slice(0, Math.min(buffer.length, 200));
  let nullBytes = 0;
  for (const byte of sample.values()) {
    if (byte === 0) {
      nullBytes += 1;
    }
  }

  return nullBytes > sample.length * 0.2
    ? buffer.toString('utf16le')
    : buffer.toString('utf8');
}

function detectDelimiter(headerLine) {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.replace(/\u0000/g, '').trim());
}

function parseCsv(buffer) {
  const text = decodeCsvBuffer(buffer).replace(/^\uFEFF/, '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeText);

  return lines.slice(1)
    .map((line) => parseDelimitedLine(line, delimiter))
    .map((values) => headers.reduce((row, header, index) => {
      if (header) {
        row[header] = values[index] || '';
      }
      return row;
    }, {}))
    .filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
    .map((row) => Object.entries(row).reduce((normalized, [key, value]) => {
      normalized[normalizeText(key)] = value;
      return normalized;
    }, {}));
}

function parseImportFile(file) {
  if (!file || !file.buffer) {
    return [];
  }

  const filename = String(file.originalname || '').toLowerCase();
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    return parseWorkbook(file.buffer);
  }

  return parseCsv(file.buffer);
}

function parseInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = String(value).replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function extractCandidateNames(rawName) {
  const full = String(rawName || '').replace(/\u0000/g, '').trim();
  const withoutAlias = full.split(' - ')[0].trim();
  const alias = full.includes(' - ') ? full.split(' - ').slice(1).join(' - ').trim() : '';
  const candidates = [full, withoutAlias, alias].filter(Boolean);

  if (withoutAlias.includes(',')) {
    const [lastName, firstName] = withoutAlias.split(',');
    candidates.push(`${firstName || ''} ${lastName || ''}`.trim());
  }

  return [...new Set(candidates.map(normalizeText).filter(Boolean))];
}

function buildRosterIndex(roster = []) {
  const index = new Map();

  roster.forEach((player) => {
    const firstName = player.first_name || '';
    const lastName = player.last_name || '';
    const names = [
      `${firstName} ${lastName}`,
      `${lastName} ${firstName}`,
      `${firstName}`,
      `${lastName}`,
    ].map(normalizeText).filter(Boolean);

    names.forEach((name) => {
      if (!index.has(name)) {
        index.set(name, []);
      }
      index.get(name).push(player);
    });
  });

  return index;
}

function findRosterPlayer(row, rosterIndex) {
  const candidates = extractCandidateNames(row.nombre || row.jugador || row.player || row.name);

  for (const candidate of candidates) {
    const matches = rosterIndex.get(candidate) || [];
    if (matches.length === 1) {
      return { player: matches[0], matchKey: candidate };
    }
  }

  return { player: null, matchKey: candidates[0] || '' };
}

function buildCompetitionImportPreview({ file, roster = [] }) {
  const rawRows = parseImportFile(file);
  const rosterIndex = buildRosterIndex(roster);
  const seenPlayerIds = new Set();

  const rows = rawRows.map((row, index) => {
    const sourceName = row.nombre ?? row.jugador ?? row.player ?? row.name ?? '';
    const minutes = parseInteger(row.minutos ?? row.minutes);
    const matches = parseInteger(row.partidos ?? row.matches);
    const teamCode = row.equipo ?? row.team ?? '';
    const { player, matchKey } = findRosterPlayer(row, rosterIndex);
    const errors = [];

    if (!sourceName) {
      errors.push('Fila sin nombre de jugador.');
    }
    if (minutes === null) {
      errors.push('Minutos no validos.');
    }
    if (!player) {
      errors.push('Jugador no encontrado en la plantilla seleccionada.');
    }
    if (player && seenPlayerIds.has(Number(player.player_id))) {
      errors.push('Jugador duplicado en el archivo.');
    }
    if (player) {
      seenPlayerIds.add(Number(player.player_id));
    }

    return {
      rowNumber: index + 2,
      sourceName,
      teamCode,
      matches,
      minutes,
      matchedPlayerId: player ? Number(player.player_id) : null,
      matchedPlayerName: player ? `${player.first_name || ''} ${player.last_name || ''}`.trim() : null,
      matchKey,
      errors,
      importable: errors.length === 0,
    };
  });

  return {
    totalRows: rows.length,
    importableRows: rows.filter((row) => row.importable).length,
    errorRows: rows.filter((row) => !row.importable).length,
    rows,
  };
}

function buildActivityPayloadFromPreview(preview, {
  teamId,
  seasonId,
  activityDate,
  title,
  notes = null,
}) {
  const importableRows = (preview && preview.rows ? preview.rows : [])
    .filter((row) => row.importable);

  return {
    team_id: teamId,
    season_id: seasonId,
    activity_type: 'MATCH',
    activity_date: activityDate,
    title,
    duration_minutes: '',
    status: 'done',
    notes,
    entries: importableRows.map((row) => ({
      player_id: row.matchedPlayerId,
      attended: Number(row.minutes || 0) > 0,
      exposure_minutes: Number(row.minutes || 0),
      notes: row.matches !== null && row.matches !== undefined ? `${row.matches} partidos en archivo` : null,
    })),
  };
}

module.exports = {
  normalizeText,
  parseImportFile,
  buildCompetitionImportPreview,
  buildActivityPayloadFromPreview,
};
