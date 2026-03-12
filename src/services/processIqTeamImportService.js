const { getAllSections } = require('../models/sectionModel');
const { getAllCategories } = require('../models/categoryModel');
const {
  getSeasonsByClubId,
  createSeason,
} = require('../models/seasonModel');
const {
  createTeam,
  getTeamsByClubId,
} = require('../models/teamModel');

const DEFAULT_API_URL = 'https://api.processiq.es';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function buildLookup(items) {
  return items.reduce((map, item) => {
    map.set(normalizeText(item.name), item);
    return map;
  }, new Map());
}

function unwrapTeamsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload && Array.isArray(payload.teams)) {
    return payload.teams;
  }
  if (payload && payload.data && Array.isArray(payload.data.teams)) {
    return payload.data.teams;
  }
  return [];
}

function canonicalSectionName(value) {
  const normalized = normalizeText(value);
  if (['masculina', 'masculino', 'male', 'men', 'boys'].includes(normalized)) {
    return 'Masculina';
  }
  if (['femenina', 'femenino', 'female', 'women', 'girls'].includes(normalized)) {
    return 'Femenina';
  }
  return String(value || '').trim();
}

function inferSectionNameFromTeamName(name) {
  const normalized = normalizeText(name);
  if (!normalized) {
    return '';
  }
  if (normalized.includes('femenin') || normalized.includes('fem')) {
    return 'Femenina';
  }
  if (normalized.includes('masculin') || normalized.includes('masc') || normalized.includes('mixto')) {
    return 'Masculina';
  }
  return 'Masculina';
}

function canonicalCategoryName(value) {
  const normalized = normalizeText(value);
  const aliases = {
    juvenil: 'Juvenil',
    cadete: 'Cadete',
    infantil: 'Infantil',
    alevin: 'Alevín',
    benjamin: 'Benjamín',
    prebenjamin: 'Prebenjamín',
    debutantes: 'Debutantes',
  };
  return aliases[normalized] || String(value || '').trim();
}

function inferCategoryNameFromTeamName(name) {
  const normalized = normalizeText(name);
  const categoryPatterns = [
    ['juvenil', 'Juvenil'],
    ['cadete', 'Cadete'],
    ['infantil', 'Infantil'],
    ['alevin', 'Alevín'],
    ['benjamin', 'Benjamín'],
    ['prebenjamin', 'Prebenjamín'],
    ['debutantes', 'Debutantes'],
    ['debutante', 'Debutantes'],
  ];

  const match = categoryPatterns.find(([pattern]) => normalized.includes(pattern));
  return match ? match[1] : '';
}

function normalizeSeasonName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const compact = raw.replace(/\s+/g, '');
  const fullYearMatch = compact.match(/^(\d{4})[/-](\d{2}|\d{4})$/);
  if (fullYearMatch) {
    const startYear = fullYearMatch[1];
    const endYear = fullYearMatch[2].length === 4 ? fullYearMatch[2].slice(-2) : fullYearMatch[2];
    return `${startYear}/${endYear}`;
  }

  return raw;
}

function extractField(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
      return String(item[key]).trim();
    }
  }
  return '';
}

function mapExternalTeam(item) {
  const sourceName = extractField(item, ['name', 'teamName', 'team_name', 'nombre']);
  const explicitSection = extractField(item, ['section', 'sectionName', 'section_name', 'seccion', 'gender']);
  const explicitCategory = extractField(item, ['category', 'categoryName', 'category_name', 'categoria', 'ageGroup']);

  return {
    externalId: extractField(item, ['id', 'teamId', 'team_id', 'externalId', 'external_id']),
    sourceName,
    sourceSectionName: explicitSection || inferSectionNameFromTeamName(sourceName),
    sourceCategoryName: explicitCategory || inferCategoryNameFromTeamName(sourceName),
    sourceSeasonName: extractField(item, ['season', 'seasonName', 'season_name', 'temporada']),
  };
}

function extractTokenFromPayload(payload) {
  if (!payload) {
    return null;
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }

  const directCandidates = [
    payload.access_token,
    payload.accessToken,
    payload.token,
    payload.jwt,
    payload.id_token,
    payload.idToken,
    payload.bearer,
    payload.bearerToken,
  ];
  const directMatch = directCandidates.find((value) => typeof value === 'string' && value.trim());
  if (directMatch) {
    return directMatch.trim();
  }

  const nestedCandidates = [
    payload.data,
    payload.result,
    payload.response,
    payload.auth,
  ];

  for (const candidate of nestedCandidates) {
    const nestedToken = extractTokenFromPayload(candidate);
    if (nestedToken) {
      return nestedToken;
    }
  }

  return null;
}

async function fetchProcessIqToken(credentials) {
  if (!credentials || !credentials.username || !credentials.password) {
    throw new Error('PROCESSIQ_CREDENTIALS_MISSING');
  }

  const response = await fetch(`${process.env.PROCESSIQ_API_URL || DEFAULT_API_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password,
    }),
  });

  if (!response.ok) {
    const error = new Error('PROCESSIQ_AUTH_FAILED');
    error.status = response.status;
    error.bodyText = await response.text();
    throw error;
  }

  const contentType = response.headers && typeof response.headers.get === 'function'
    ? (response.headers.get('content-type') || '')
    : '';
  let payload;
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else if (typeof response.json === 'function') {
    try {
      payload = await response.json();
    } catch (error) {
      payload = typeof response.text === 'function' ? await response.text() : null;
    }
  } else {
    payload = typeof response.text === 'function' ? await response.text() : null;
  }

  const token = extractTokenFromPayload(payload);
  if (!token) {
    const error = new Error('PROCESSIQ_TOKEN_INVALID');
    error.payload = payload;
    throw error;
  }

  return token;
}

async function fetchProcessIqTeams(credentials) {
  return fetchProcessIqJson('/teams', credentials);
}

async function fetchProcessIqJson(path, credentials) {
  const token = await fetchProcessIqToken(credentials);
  return fetchProcessIqJsonWithToken(path, token);
}

async function fetchProcessIqJsonWithToken(path, token) {
  const response = await fetch(`${process.env.PROCESSIQ_API_URL || DEFAULT_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const error = new Error('PROCESSIQ_FETCH_FAILED');
    error.status = response.status;
    error.bodyText = await response.text();
    throw error;
  }

  return response.json();
}

async function buildImportPreview(club, credentials) {
  if (!club) {
    throw new Error('CLUB_REQUIRED');
  }

  const payload = await fetchProcessIqTeams(credentials);
  const externalTeams = unwrapTeamsPayload(payload).map(mapExternalTeam);
  const [sections, categories, seasons, existingTeams] = await Promise.all([
    getAllSections(),
    getAllCategories(),
    getSeasonsByClubId(club.id),
    getTeamsByClubId(club.id),
  ]);

  const sectionsByName = buildLookup(sections);
  const categoriesByName = buildLookup(categories);
  const seasonsByName = seasons.reduce((map, season) => {
    map.set(normalizeText(season.name), season);
    return map;
  }, new Map());
  const existingScopes = new Set(existingTeams.map((team) => [
    team.club_id,
    team.season_id,
    team.section_id,
    team.category_id,
    normalizeText(team.name),
  ].join('|')));

  const previewItems = externalTeams.map((team, index) => {
    const name = team.sourceName.trim();
    const sectionName = canonicalSectionName(team.sourceSectionName);
    const categoryName = canonicalCategoryName(team.sourceCategoryName);
    const seasonName = normalizeSeasonName(team.sourceSeasonName);
    const section = sectionsByName.get(normalizeText(sectionName)) || null;
    const category = categoriesByName.get(normalizeText(categoryName)) || null;
    const season = seasonsByName.get(normalizeText(seasonName)) || null;
    const scopeKey = section && category && season && name
      ? [club.id, season.id, section.id, category.id, normalizeText(name)].join('|')
      : null;

    return {
      id: String(index),
      externalId: team.externalId,
      sourceName: team.sourceName,
      sourceSectionName: team.sourceSectionName,
      sourceCategoryName: team.sourceCategoryName,
      sourceSeasonName: team.sourceSeasonName,
      name,
      sectionId: section ? section.id : '',
      categoryId: category ? category.id : '',
      seasonId: season ? season.id : '',
      importable: Boolean(name && section && category && season),
      duplicate: Boolean(scopeKey && existingScopes.has(scopeKey)),
      issues: [
        !name ? 'Nombre vacío' : null,
        !section ? 'Sección sin mapear' : null,
        !category ? 'Categoría sin mapear' : null,
        !seasonName ? 'Temporada vacía' : null,
      ].filter(Boolean),
    };
  });

  return {
    items: previewItems,
    options: {
      sections,
      categories,
      seasons,
    },
    diagnostics: {
      receivedCount: externalTeams.length,
      importableCount: previewItems.filter((item) => item.importable && !item.duplicate).length,
      duplicateCount: previewItems.filter((item) => item.duplicate).length,
      reviewCount: previewItems.filter((item) => item.issues.length > 0).length,
    },
  };
}

function coerceToArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
}

function buildSubmissionEntries(formBody, previewItems) {
  const selectedIds = new Set(coerceToArray(formBody.selected_ids).map(String));
  const names = coerceToArray(formBody.name);
  const seasonIds = coerceToArray(formBody.season_id);
  const sectionIds = coerceToArray(formBody.section_id);
  const categoryIds = coerceToArray(formBody.category_id);
  const previewIds = coerceToArray(formBody.preview_id);

  return previewIds.map((previewId, index) => {
    const original = previewItems.find((item) => item.id === String(previewId));
    return {
      previewId: String(previewId),
      selected: selectedIds.has(String(previewId)),
      name: String(names[index] || '').trim(),
      seasonId: String(seasonIds[index] || '').trim(),
      sectionId: String(sectionIds[index] || '').trim(),
      categoryId: String(categoryIds[index] || '').trim(),
      original,
    };
  });
}

async function resolveSeason(clubId, seasonId, seasonsById) {
  if (seasonsById.has(seasonId)) {
    return seasonsById.get(seasonId);
  }
  return null;
}

async function importSelectedTeams(club, previewItems, formBody) {
  const [sections, categories, seasons, existingTeams] = await Promise.all([
    getAllSections(),
    getAllCategories(),
    getSeasonsByClubId(club.id),
    getTeamsByClubId(club.id),
  ]);

  const sectionsById = new Map(sections.map((item) => [item.id, item]));
  const categoriesById = new Map(categories.map((item) => [item.id, item]));
  const seasonsById = new Map(seasons.map((item) => [item.id, item]));
  const existingScopes = new Set(existingTeams.map((team) => [
    team.club_id,
    team.season_id,
    team.section_id,
    team.category_id,
    normalizeText(team.name),
  ].join('|')));
  const entries = buildSubmissionEntries(formBody, previewItems);

  const summary = {
    created: 0,
    skipped: 0,
    errors: [],
  };

  for (const entry of entries) {
    if (!entry.selected) {
      summary.skipped += 1;
      continue;
    }

    const season = await resolveSeason(club.id, entry.seasonId, seasonsById);
    const section = sectionsById.get(entry.sectionId) || null;
    const category = categoriesById.get(entry.categoryId) || null;
    if (!entry.name || !season || !section || !category) {
      summary.errors.push(`Fila ${entry.previewId}: faltan datos válidos para importar.`);
      continue;
    }

    const scopeKey = [
      club.id,
      season.id,
      section.id,
      category.id,
      normalizeText(entry.name),
    ].join('|');

    if (existingScopes.has(scopeKey)) {
      summary.skipped += 1;
      continue;
    }

    // Evita duplicados dentro de la misma confirmación.
    existingScopes.add(scopeKey);
    // eslint-disable-next-line no-await-in-loop
    await createTeam({
      clubId: club.id,
      seasonId: season.id,
      sectionId: section.id,
      categoryId: category.id,
      name: entry.name,
      source: 'processiq',
      externalId: entry.original ? entry.original.externalId : null,
    });
    summary.created += 1;
  }

  return summary;
}

module.exports = {
  buildImportPreview,
  fetchProcessIqJsonWithToken,
  fetchProcessIqToken,
  fetchProcessIqJson,
  importSelectedTeams,
  normalizeText,
};
