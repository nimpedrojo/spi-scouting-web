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

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
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
  if (['d', 'der', 'derecha', 'right'].includes(normalized)) {
    return 'DER';
  }
  if (['i', 'izq', 'izquierda', 'left'].includes(normalized)) {
    return 'IZQ';
  }
  if (['ambidiestro', 'ambi', 'both'].includes(normalized)) {
    return 'AMB';
  }
  return String(value || '').trim().slice(0, 20) || null;
}

function mapPlayerDetail(detail, playerRef, team) {
  const fullName = extractText(detail, ['name', 'fullName', 'full_name', 'displayName']);
  const split = splitName(fullName);
  const firstName = extractText(detail, ['firstName', 'first_name', 'givenName']) || split.firstName;
  const lastName = extractText(detail, ['lastName', 'last_name', 'surname', 'familyName']) || split.lastName;
  const birthDate = extractText(detail, ['birthDate', 'birth_date', 'dateOfBirth']) || null;
  const birthYearRaw = extractText(detail, ['birthYear', 'birth_year']);
  const birthYear = birthYearRaw
    ? Number.parseInt(birthYearRaw, 10)
    : (birthDate ? Number.parseInt(birthDate.slice(0, 4), 10) : null);
  const dorsal = extractText(playerRef, ['dorsal', 'shirtNumber', 'number'])
    || extractText(detail, ['dorsal', 'shirtNumber', 'number'])
    || null;
  const positions = extractText(playerRef, ['positions', 'position'])
    || extractText(detail, ['positions', 'position', 'primaryPosition'])
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
    laterality: normalizeFoot(extractText(detail, ['laterality', 'dominantFoot', 'foot', 'preferredFoot'])),
    preferredFoot: normalizeFoot(extractText(detail, ['preferredFoot', 'dominantFoot', 'foot'])),
    phone: extractText(detail, ['phone', 'phoneNumber']) || null,
    email: extractText(detail, ['email']) || null,
    nationality: extractText(detail, ['nationality', 'country']) || null,
    dorsal,
    positions,
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
      const detail = detailPayload && detailPayload.data && !Array.isArray(detailPayload.data)
        ? detailPayload.data
        : detailPayload;
      const mapped = mapPlayerDetail(detail, playerRef, team);
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
