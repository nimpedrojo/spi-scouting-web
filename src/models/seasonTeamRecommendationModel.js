const { randomUUID } = require('crypto');
const db = require('../db');

const SEASON_TEAM_RECOMMENDATION_SOURCE_TYPES = ['internal', 'scouted'];
const SEASON_TEAM_RECOMMENDATION_STATUSES = ['proposed', 'in_review', 'validated', 'discarded'];

function normalizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeNullableLowercaseString(value) {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeNullableInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function validateSeasonTeamRecommendationPayload(payload = {}) {
  const errors = [];
  const clubId = normalizeNullableInteger(payload.clubId);
  const seasonId = normalizeNullableString(payload.seasonId);
  const sourceType = normalizeNullableLowercaseString(payload.sourceType);
  const playerId = normalizeNullableInteger(payload.playerId);
  const scoutedPlayerId = normalizeNullableString(payload.scoutedPlayerId);
  const recommendedTeamId = normalizeNullableString(payload.recommendedTeamId);
  const recommendedTeamLabel = normalizeNullableString(payload.recommendedTeamLabel);
  const status = normalizeNullableLowercaseString(payload.status) || 'proposed';
  const createdBy = normalizeNullableInteger(payload.createdBy);

  if (!clubId) {
    errors.push('El club es obligatorio.');
  }

  if (!seasonId) {
    errors.push('La temporada destino es obligatoria.');
  }

  if (!SEASON_TEAM_RECOMMENDATION_SOURCE_TYPES.includes(sourceType)) {
    errors.push('El tipo de origen no es valido.');
  }

  if (!SEASON_TEAM_RECOMMENDATION_STATUSES.includes(status)) {
    errors.push('El estado no es valido.');
  }

  if (!createdBy) {
    errors.push('El usuario creador es obligatorio.');
  }

  if (sourceType === 'internal') {
    if (!playerId) {
      errors.push('El jugador interno es obligatorio cuando el origen es internal.');
    }

    if (scoutedPlayerId) {
      errors.push('No se puede informar un jugador scouted cuando el origen es internal.');
    }
  }

  if (sourceType === 'scouted') {
    if (!scoutedPlayerId) {
      errors.push('El identificador del jugador scouted es obligatorio cuando el origen es scouted.');
    }

    if (playerId) {
      errors.push('No se puede informar un jugador interno cuando el origen es scouted.');
    }
  }

  if (recommendedTeamLabel && recommendedTeamLabel.length > 150) {
    errors.push('La etiqueta de equipo recomendado no puede superar los 150 caracteres.');
  }

  return errors;
}

function mapRecommendationPayload(payload = {}) {
  return {
    clubId: normalizeNullableInteger(payload.clubId),
    seasonId: normalizeNullableString(payload.seasonId),
    sourceType: normalizeNullableLowercaseString(payload.sourceType),
    playerId: normalizeNullableInteger(payload.playerId),
    scoutedPlayerId: normalizeNullableString(payload.scoutedPlayerId),
    recommendedTeamId: normalizeNullableString(payload.recommendedTeamId),
    recommendedTeamLabel: normalizeNullableString(payload.recommendedTeamLabel),
    status: normalizeNullableLowercaseString(payload.status) || 'proposed',
    notes: normalizeNullableString(payload.notes),
    createdBy: normalizeNullableInteger(payload.createdBy),
  };
}

function buildValidationError(errors) {
  const error = new Error('SEASON_TEAM_RECOMMENDATION_VALIDATION_ERROR');
  error.validationErrors = errors;
  return error;
}

async function createSeasonTeamRecommendationsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS season_team_recommendations (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      season_id CHAR(36) NOT NULL,
      source_type ENUM('internal', 'scouted') NOT NULL,
      player_id INT NULL,
      scouted_player_id VARCHAR(100) NULL,
      recommended_team_id CHAR(36) NULL,
      recommended_team_label VARCHAR(150) NULL,
      status ENUM('proposed', 'in_review', 'validated', 'discarded') NOT NULL DEFAULT 'proposed',
      notes TEXT NULL,
      created_by INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_str_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_str_season
        FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_str_player
        FOREIGN KEY (player_id) REFERENCES players(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_str_recommended_team
        FOREIGN KEY (recommended_team_id) REFERENCES teams(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_str_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT,
      KEY idx_str_club_season (club_id, season_id),
      KEY idx_str_player (player_id),
      KEY idx_str_scouted_player (scouted_player_id),
      KEY idx_str_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function createSeasonTeamRecommendation(payload) {
  const errors = validateSeasonTeamRecommendationPayload(payload);
  if (errors.length) {
    throw buildValidationError(errors);
  }

  const data = mapRecommendationPayload(payload);
  const id = randomUUID();

  await db.query(
    `INSERT INTO season_team_recommendations (
      id,
      club_id,
      season_id,
      source_type,
      player_id,
      scouted_player_id,
      recommended_team_id,
      recommended_team_label,
      status,
      notes,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.clubId,
      data.seasonId,
      data.sourceType,
      data.playerId,
      data.scoutedPlayerId,
      data.recommendedTeamId,
      data.recommendedTeamLabel,
      data.status,
      data.notes,
      data.createdBy,
    ],
  );

  return findSeasonTeamRecommendationById(id);
}

async function findSeasonTeamRecommendationById(id) {
  const [rows] = await db.query(
    `SELECT
        str.*,
        p.first_name AS player_first_name,
        p.last_name AS player_last_name,
        t.name AS recommended_team_name,
        u.name AS created_by_name
      FROM season_team_recommendations str
      LEFT JOIN players p ON p.id = str.player_id
      LEFT JOIN teams t ON t.id = str.recommended_team_id
      LEFT JOIN users u ON u.id = str.created_by
      WHERE str.id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function findSeasonTeamRecommendationByIdAndClubId(id, clubId) {
  const [rows] = await db.query(
    `SELECT
        str.*,
        p.first_name AS player_first_name,
        p.last_name AS player_last_name,
        t.name AS recommended_team_name,
        u.name AS created_by_name
      FROM season_team_recommendations str
      LEFT JOIN players p ON p.id = str.player_id
      LEFT JOIN teams t ON t.id = str.recommended_team_id
      LEFT JOIN users u ON u.id = str.created_by
      WHERE str.id = ? AND str.club_id = ?`,
    [id, clubId],
  );
  return rows[0] || null;
}

async function getSeasonTeamRecommendationsByClubId(clubId, seasonId = null) {
  let sql = `
    SELECT
      str.*,
      p.first_name AS player_first_name,
      p.last_name AS player_last_name,
      t.name AS recommended_team_name,
      u.name AS created_by_name
    FROM season_team_recommendations str
    LEFT JOIN players p ON p.id = str.player_id
    LEFT JOIN teams t ON t.id = str.recommended_team_id
    LEFT JOIN users u ON u.id = str.created_by
    WHERE str.club_id = ?
  `;
  const params = [clubId];

  if (seasonId) {
    sql += ' AND str.season_id = ?';
    params.push(seasonId);
  }

  sql += ' ORDER BY str.created_at DESC, str.updated_at DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function getSeasonTeamRecommendationsByFilters(filters = {}) {
  let sql = `
    SELECT
      str.*,
      p.first_name AS player_first_name,
      p.last_name AS player_last_name,
      t.name AS recommended_team_name,
      u.name AS created_by_name
    FROM season_team_recommendations str
    LEFT JOIN players p ON p.id = str.player_id
    LEFT JOIN teams t ON t.id = str.recommended_team_id
    LEFT JOIN users u ON u.id = str.created_by
    WHERE 1 = 1
  `;
  const params = [];

  if (filters.clubId) {
    sql += ' AND str.club_id = ?';
    params.push(filters.clubId);
  }

  if (filters.seasonId) {
    sql += ' AND str.season_id = ?';
    params.push(filters.seasonId);
  }

  if (filters.teamId) {
    sql += ' AND str.recommended_team_id = ?';
    params.push(filters.teamId);
  }

  if (filters.playerId) {
    sql += ' AND str.player_id = ?';
    params.push(filters.playerId);
  }

  if (filters.sourceType) {
    sql += ' AND str.source_type = ?';
    params.push(normalizeNullableLowercaseString(filters.sourceType));
  }

  sql += ' ORDER BY str.created_at DESC, str.updated_at DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function updateSeasonTeamRecommendation(id, payload = {}) {
  const fields = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(payload, 'recommendedTeamId')) {
    fields.push('recommended_team_id = ?');
    params.push(normalizeNullableString(payload.recommendedTeamId));
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'recommendedTeamLabel')) {
    fields.push('recommended_team_label = ?');
    params.push(normalizeNullableString(payload.recommendedTeamLabel));
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    fields.push('status = ?');
    params.push(normalizeNullableLowercaseString(payload.status));
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
    fields.push('notes = ?');
    params.push(normalizeNullableString(payload.notes));
  }

  if (!fields.length) {
    return 0;
  }

  params.push(id);
  const [result] = await db.query(
    `UPDATE season_team_recommendations
     SET ${fields.join(', ')}
     WHERE id = ?`,
    params,
  );
  return result.affectedRows;
}

module.exports = {
  SEASON_TEAM_RECOMMENDATION_SOURCE_TYPES,
  SEASON_TEAM_RECOMMENDATION_STATUSES,
  createSeasonTeamRecommendationsTable,
  createSeasonTeamRecommendation,
  findSeasonTeamRecommendationById,
  findSeasonTeamRecommendationByIdAndClubId,
  getSeasonTeamRecommendationsByClubId,
  getSeasonTeamRecommendationsByFilters,
  updateSeasonTeamRecommendation,
  validateSeasonTeamRecommendationPayload,
};
