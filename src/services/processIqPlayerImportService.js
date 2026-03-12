const { findPlayerBySourceExternalId, insertPlayer, updatePlayer } = require('../models/playerModel');
const { upsertTeamPlayer } = require('../models/teamPlayerModel');
const {
  fetchProcessIqJsonWithToken,
  fetchProcessIqToken,
  normalizeText,
} = require('./processIqTeamImportService');

function unwrapPlayers(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && Array.isArray(value.players)) {
    return value.players;
  }
  if (value && value.data && Array.isArray(value.data.players)) {
    return value.data.players;
  }
  return [];
}

function extractPlayerId(playerRef) {
  if (!playerRef) {
    return '';
  }
  if (typeof playerRef === 'string' || typeof playerRef === 'number') {
    return String(playerRef).trim();
  }

  const candidates = [
    playerRef.id,
    playerRef.playerId,
    playerRef.player_id,
    playerRef.externalId,
    playerRef.external_id,
  ];
  const match = candidates.find((value) => value !== undefined && value !== null && String(value).trim());
  return match ? String(match).trim() : '';
}

function extractText(item, keys) {
  for (const key of keys) {
    const value = item ? item[key] : null;
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function normalizePlayerDetailPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const detail = payload.item && typeof payload.item === 'object'
    ? payload.item
    : (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : payload);

  const fields = detail.fields && typeof detail.fields === 'object' && !Array.isArray(detail.fields)
    ? detail.fields
    : {};

  return {
    ...fields,
    ...detail,
  };
}

function splitName(fullName) {
  const normalized = String(fullName || '').trim();
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  if (normalized.includes(',')) {
    const [lastNamePart, firstNamePart] = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    if (firstNamePart || lastNamePart) {
      return {
        firstName: firstNamePart || '',
        lastName: lastNamePart || '',
      };
    }
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '-' };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.slice(-1).join(' '),
  };
}

function normalizeFoot(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (['d', 'der', 'derecha', 'derecho', 'right'].includes(normalized)) {
    return 'DER';
  }
  if (['i', 'izq', 'izquierda', 'izquierdo', 'left'].includes(normalized)) {
    return 'IZQ';
  }
  if (['ambidiestro', 'ambi', 'both'].includes(normalized)) {
    return 'AMB';
  }
  return String(value || '').trim().slice(0, 20) || null;
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  return raw;
}

function parseStatNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).replace(',', '.').trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPlayerStats(detail) {
  return {
    callups: parseStatNumber(extractText(detail, ['estadistica_conv.', 'estadistica_convocados', 'convocatorias'])),
    starts: parseStatNumber(extractText(detail, ['estadistica_tit.', 'estadistica_titulares', 'titularidades'])),
    substituteAppearances: parseStatNumber(extractText(detail, ['estadistica_supl.', 'estadistica_suplentes'])),
    unusedCallups: parseStatNumber(extractText(detail, ['estadistica_s/jug.', 'estadistica_sin_jugar'])),
    notCalledUp: parseStatNumber(extractText(detail, ['estadistica_no_conv.', 'estadistica_no_convocados'])),
    minutes: parseStatNumber(extractText(detail, ['estadistica_minutos', 'minutos'])),
    goals: parseStatNumber(extractText(detail, ['estadistica_goles', 'goles'])),
  };
}

function mapPlayerDetail(detail, playerRef, team) {
  const normalizedDetail = normalizePlayerDetailPayload(detail);
  const fullName = extractText(normalizedDetail, ['name', 'fullName', 'full_name', 'displayName'])
    || extractText(playerRef, ['fullName', 'full_name', 'name', 'displayName']);
  const split = splitName(fullName);
  const firstName = extractText(normalizedDetail, ['firstName', 'first_name', 'givenName', 'shortName', 'short_name'])
    || extractText(playerRef, ['shortName', 'short_name'])
    || split.firstName;
  const lastName = extractText(normalizedDetail, ['lastName', 'last_name', 'surname', 'familyName']) || split.lastName;
  const birthDate = normalizeBirthDate(
    extractText(normalizedDetail, ['birthDate', 'birth_date', 'dateOfBirth', 'fecha_nacimiento']),
  );
  const birthYearRaw = extractText(normalizedDetail, ['birthYear', 'birth_year']);
  const birthYear = birthYearRaw
    ? Number.parseInt(birthYearRaw, 10)
    : (birthDate
      ? Number.parseInt(
        /^\d{2}\/\d{2}\/\d{4}$/.test(birthDate) ? birthDate.slice(-4) : birthDate.slice(0, 4),
        10,
      )
      : null);
  const dorsal = extractText(playerRef, ['dorsal', 'shirtNumber', 'number'])
    || extractText(normalizedDetail, ['dorsal', 'shirtNumber', 'number'])
    || null;
  const positions = extractText(playerRef, ['positions', 'position'])
    || extractText(normalizedDetail, ['positions', 'position', 'primaryPosition', 'posiciones'])
    || null;

  return {
    firstName: firstName || 'Jugador',
    lastName: lastName || '-',
    club: team.club_name,
    clubId: team.club_id,
    team: team.name,
    currentTeamId: team.id,
    birthDate,
    birthYear: Number.isNaN(birthYear) ? null : birthYear,
    laterality: normalizeFoot(extractText(normalizedDetail, ['laterality', 'dominantFoot', 'foot', 'preferredFoot', 'lateralidad'])),
    preferredFoot: normalizeFoot(extractText(normalizedDetail, ['preferredFoot', 'dominantFoot', 'foot', 'lateralidad'])),
    phone: extractText(normalizedDetail, ['phone', 'phoneNumber', 'teléfonos', 'telefonos']) || null,
    email: extractText(normalizedDetail, ['email']) || null,
    nationality: extractText(normalizedDetail, ['nationality', 'country', 'nacionalidad']) || null,
    dorsal,
    positions,
    stats: extractPlayerStats(normalizedDetail),
  };
}

async function importPlayersFromProcessIq(team, credentials) {
  if (!team || team.source !== 'processiq' || !team.external_id) {
    throw new Error('PROCESSIQ_TEAM_NOT_LINKED');
  }

  const token = await fetchProcessIqToken(credentials);
  const extendedPayload = await fetchProcessIqJsonWithToken('/teams/extended', token);
  const extendedTeams = Array.isArray(extendedPayload && extendedPayload.items)
    ? extendedPayload.items
    : (Array.isArray(extendedPayload) ? extendedPayload : []);
  const externalTeam = extendedTeams.find(
    (item) => String(item.id || item.teamId || '').trim() === String(team.external_id).trim(),
  );

  if (!externalTeam) {
    throw new Error('PROCESSIQ_EXTENDED_TEAM_NOT_FOUND');
  }

  const playerRefs = unwrapPlayers(externalTeam.players);
  const summary = {
    rosterCount: playerRefs.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const playerRef of playerRefs) {
    const playerId = extractPlayerId(playerRef);
    if (!playerId) {
      summary.skipped += 1;
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const detailPayload = await fetchProcessIqJsonWithToken(`/players/${encodeURIComponent(playerId)}`, token);
      const mapped = mapPlayerDetail(detailPayload, playerRef, team);
      // eslint-disable-next-line no-await-in-loop
      const existing = await findPlayerBySourceExternalId('processiq', playerId);

      let localPlayerId;
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        await updatePlayer(existing.id, {
          ...mapped,
          source: 'processiq',
          externalId: playerId,
        });
        localPlayerId = existing.id;
        summary.updated += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        localPlayerId = await insertPlayer({
          ...mapped,
          source: 'processiq',
          externalId: playerId,
        });
        summary.created += 1;
      }

      // eslint-disable-next-line no-await-in-loop
      await upsertTeamPlayer({
        teamId: team.id,
        playerId: localPlayerId,
        dorsal: mapped.dorsal,
        positions: mapped.positions,
      });
    } catch (error) {
      summary.errors.push(`Jugador ${playerId}: ${error.message}`);
    }
  }

  return summary;
}

module.exports = {
  importPlayersFromProcessIq,
};
