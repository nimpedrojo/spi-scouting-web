const XLSX = require('xlsx');
const zlib = require('zlib');

const TRAINING_SESSION_MINUTES = 90;
const TRAINING_ATTENDED_CODES = new Set(['A', 'R']);
const TRAINING_KNOWN_CODES = new Set(['A', 'F', 'J', 'R', 'P', 'L', 'S', 'O']);
const TRAINING_CODE_NOTES = {
  F: 'Falta injustificada en archivo',
  J: 'Falta justificada en archivo',
  R: 'Retraso en archivo',
  P: 'Permiso en archivo',
  L: 'Lesion/enfermedad en archivo',
  S: 'Convocatoria seleccion en archivo',
  O: 'Otros en archivo',
};
const MONTH_NAMES = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

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

function decodePdfString(value) {
  return String(value || '')
    .replace(/\\([\\()])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function extractPdfInfo(buffer) {
  const source = buffer.toString('latin1');
  const titleMatch = source.match(/\/Title\s*\((.*?)\)/s);
  const creationMatch = source.match(/\/CreationDate\s*\(D:(\d{4})/);
  return {
    title: titleMatch ? decodePdfString(titleMatch[1]) : '',
    year: creationMatch ? Number(creationMatch[1]) : null,
  };
}

function extractPdfTextItems(buffer) {
  const source = buffer.toString('latin1');
  const streamPattern = /stream\s*([\s\S]*?)\s*endstream/g;
  const items = [];
  let streamMatch;

  while ((streamMatch = streamPattern.exec(source)) !== null) {
    let content = null;
    try {
      content = zlib.inflateSync(Buffer.from(streamMatch[1], 'latin1')).toString('latin1');
    } catch (_error) {
      content = null;
    }
    if (!content) {
      continue;
    }

    const blockPattern = /BT\s*([\s\S]*?)\s*ET/g;
    let blockMatch;
    while ((blockMatch = blockPattern.exec(content)) !== null) {
      const block = blockMatch[1];
      const coordMatch = block.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td/);
      const textMatch = block.match(/\(([\s\S]*?)\)\s*Tj/);
      if (coordMatch && textMatch) {
        items.push({
          x: Number(coordMatch[1]),
          y: Number(coordMatch[2]),
          text: decodePdfString(textMatch[1]).trim(),
        });
      }
    }
  }

  return items;
}

function monthFromText(value) {
  const normalized = normalizeText(value);
  const match = Object.entries(MONTH_NAMES)
    .find(([name]) => normalized.includes(name));
  return match ? match[1] : null;
}

function parsePdfAttendanceRows(file) {
  const info = extractPdfInfo(file.buffer);
  const items = extractPdfTextItems(file.buffer);
  const header = items.find((item) => normalizeText(item.text) === 'deportista');
  if (!header) {
    return [];
  }

  const dayColumns = items
    .filter((item) => Math.abs(item.y - header.y) < 1 && /^\d{1,2}$/.test(item.text))
    .map((item) => ({ day: Number(item.text), x: item.x }))
    .filter((item) => item.day >= 1 && item.day <= 31)
    .sort((a, b) => a.day - b.day);

  if (!dayColumns.length) {
    return [];
  }

  const rowNames = items
    .filter((item) => item.y < header.y && item.x <= header.x + 80)
    .filter((item) => item.text && !/^[A-Z\s]+$/.test(item.text))
    .sort((a, b) => b.y - a.y);

  const month = monthFromText(info.title);
  const year = info.year;

  return rowNames.map((nameItem) => {
    const row = {
      nombre: nameItem.text,
      _sourceMonth: month,
      _sourceYear: year,
    };
    const cells = items.filter((item) => Math.abs(item.y - nameItem.y) < 1 && item.x > header.x + 80);

    cells.forEach((cell) => {
      const nearestColumn = dayColumns
        .map((column) => ({ ...column, distance: Math.abs(column.x - cell.x) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearestColumn && nearestColumn.distance <= 8) {
        row[String(nearestColumn.day)] = cell.text;
      }
    });

    return row;
  }).filter((row) => Object.keys(row).some((key) => /^\d{1,2}$/.test(key)));
}

function parseImportFile(file) {
  if (!file || !file.buffer) {
    return [];
  }

  const filename = String(file.originalname || '').toLowerCase();
  if (filename.endsWith('.pdf')) {
    return parsePdfAttendanceRows(file);
  }
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

function resolveImportYearMonth(rawRows, fallbackDate) {
  const fallback = String(fallbackDate || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  const rowWithSourceDate = rawRows.find((row) => row._sourceYear && row._sourceMonth) || {};
  return {
    year: Number(rowWithSourceDate._sourceYear) || (fallback ? Number(fallback[1]) : null),
    month: Number(rowWithSourceDate._sourceMonth) || (fallback ? Number(fallback[2]) : null),
  };
}

function toDateForMonthDay(year, month, day) {
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractTrainingStatuses(row) {
  return Array.from({ length: 31 }, (_value, index) => index + 1)
    .reduce((statuses, day) => {
      const rawValue = row[String(day)] ?? row[`dia ${day}`] ?? row[`day ${day}`] ?? '';
      const code = String(rawValue || '').trim().toUpperCase();
      if (TRAINING_KNOWN_CODES.has(code)) {
        statuses[day] = code;
      }
      return statuses;
    }, {});
}

function buildTrainingAttendanceImportPreview({ file, roster = [], fallbackDate = null }) {
  const rawRows = parseImportFile(file);
  const rosterIndex = buildRosterIndex(roster);
  const seenPlayerIds = new Set();
  const { year, month } = resolveImportYearMonth(rawRows, fallbackDate);
  const trainingDays = [...new Set(rawRows.flatMap((row) => Object.keys(extractTrainingStatuses(row)).map(Number)))]
    .sort((a, b) => a - b)
    .map((day) => ({ day, date: toDateForMonthDay(year, month, day) }))
    .filter((day) => day.date);

  const validTrainingDaySet = new Set(trainingDays.map((day) => Number(day.day)));

  const rows = rawRows.map((row, index) => {
    const sourceName = row.nombre ?? row.jugador ?? row.player ?? row.name ?? row.deportista ?? '';
    const statuses = extractTrainingStatuses(row);
    const attendedDays = Object.entries(statuses)
      .filter(([day, code]) => validTrainingDaySet.has(Number(day)) && TRAINING_ATTENDED_CODES.has(code))
      .length;
    const recordedDays = Object.keys(statuses)
      .filter((day) => validTrainingDaySet.has(Number(day)))
      .length;
    const { player, matchKey } = findRosterPlayer({ ...row, nombre: sourceName }, rosterIndex);
    const errors = [];

    if (!sourceName) {
      errors.push('Fila sin nombre de jugador.');
    }
    if (!recordedDays) {
      errors.push('Fila sin dias de entrenamiento reconocidos.');
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
      matchedPlayerId: player ? Number(player.player_id) : null,
      matchedPlayerName: player ? `${player.first_name || ''} ${player.last_name || ''}`.trim() : null,
      matchKey,
      statuses,
      recordedDays,
      attendedDays,
      minutes: attendedDays * TRAINING_SESSION_MINUTES,
      errors,
      importable: errors.length === 0,
    };
  });

  return {
    importType: 'training_attendance',
    totalRows: rows.length,
    importableRows: rows.filter((row) => row.importable).length,
    errorRows: rows.filter((row) => !row.importable).length,
    sessionMinutes: TRAINING_SESSION_MINUTES,
    trainingDays,
    totalSessions: trainingDays.length,
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

function buildTrainingActivityPayloadsFromPreview(preview, {
  teamId,
  seasonId,
  title,
  notes = null,
}) {
  const importableRows = (preview && preview.rows ? preview.rows : [])
    .filter((row) => row.importable);

  return (preview.trainingDays || []).map((trainingDay) => ({
    team_id: teamId,
    season_id: seasonId,
    activity_type: 'TRAINING',
    activity_date: trainingDay.date,
    title: `${title} - Dia ${trainingDay.day}`,
    duration_minutes: TRAINING_SESSION_MINUTES,
    status: 'done',
    notes,
    entries: importableRows.map((row) => {
      const code = row.statuses[String(trainingDay.day)] || '';
      const attended = TRAINING_ATTENDED_CODES.has(code);
      return {
        player_id: row.matchedPlayerId,
        attended,
        exposure_minutes: attended ? TRAINING_SESSION_MINUTES : 0,
        notes: TRAINING_CODE_NOTES[code] || null,
      };
    }),
  }));
}

function buildActivityPayloadsFromPreview(preview, options) {
  if (preview && preview.importType === 'training_attendance') {
    return buildTrainingActivityPayloadsFromPreview(preview, options);
  }
  return [buildActivityPayloadFromPreview(preview, options)];
}

module.exports = {
  normalizeText,
  parseImportFile,
  buildCompetitionImportPreview,
  buildTrainingAttendanceImportPreview,
  buildActivityPayloadFromPreview,
  buildActivityPayloadsFromPreview,
};
