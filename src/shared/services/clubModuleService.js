const {
  getModulesByClubId,
  isModuleEnabledForClub,
  setModuleEnabledForClub,
} = require('../../core/models/clubModuleModel');
const { DEFAULT_CLUB_MODULES, MODULE_KEYS } = require('../constants/moduleKeys');

const CLUB_MODULE_META = {
  [MODULE_KEYS.SCOUTING_PLAYERS]: {
    key: MODULE_KEYS.SCOUTING_PLAYERS,
    label: 'Scouting Players',
    description: 'Informes individuales, evaluaciones, comparativas y perfiles de jugador.',
    entryPath: '/assessments',
    defaultEnabled: true,
    roleSummary: 'Usuarios con acceso al club pueden consultar; admins y superadmins gestionan plantillas, evaluaciones y flujos avanzados.',
  },
  [MODULE_KEYS.PLANNING]: {
    key: MODULE_KEYS.PLANNING,
    label: 'Planning',
    description: 'Planificación deportiva y flujos de organización futuros del club.',
    entryPath: '/planning',
    defaultEnabled: false,
    roleSummary: 'Base preparada para futuros flujos de coordinación deportiva del club.',
  },
  [MODULE_KEYS.SCOUTING_TEAMS]: {
    key: MODULE_KEYS.SCOUTING_TEAMS,
    label: 'Scouting Teams',
    description: 'Scouting de rivales, informes de equipos y análisis táctico de oposición.',
    entryPath: '/scouting-teams',
    defaultEnabled: false,
    roleSummary: 'Usuarios del club pueden crear y editar sus propios informes; admins y superadmins gestionan todos los informes.',
  },
};

const CLUB_MODULE_PRESETS = {
  core_only: {
    key: 'core_only',
    label: 'Core operativo',
    description: 'Mantiene la base actual estable del club con scouting de jugadores.',
    moduleKeys: [MODULE_KEYS.SCOUTING_PLAYERS],
  },
  sporting_analysis: {
    key: 'sporting_analysis',
    label: 'Análisis deportivo',
    description: 'Activa scouting de jugadores y scouting de rivales para un staff técnico operativo.',
    moduleKeys: [MODULE_KEYS.SCOUTING_PLAYERS, MODULE_KEYS.SCOUTING_TEAMS],
  },
  full_suite: {
    key: 'full_suite',
    label: 'Suite completa',
    description: 'Habilita todos los módulos preparados actualmente para el club.',
    moduleKeys: Object.values(MODULE_KEYS),
  },
};

async function getClubModules(clubId) {
  if (!clubId) {
    return [];
  }

  const modules = await getModulesByClubId(clubId);
  return modules.map((moduleEntry) => ({
    ...moduleEntry,
    label: CLUB_MODULE_META[moduleEntry.moduleKey]
      ? CLUB_MODULE_META[moduleEntry.moduleKey].label
      : moduleEntry.moduleKey,
    description: CLUB_MODULE_META[moduleEntry.moduleKey]
      ? CLUB_MODULE_META[moduleEntry.moduleKey].description
      : '',
    entryPath: CLUB_MODULE_META[moduleEntry.moduleKey]
      ? CLUB_MODULE_META[moduleEntry.moduleKey].entryPath
      : '#',
    defaultEnabled: CLUB_MODULE_META[moduleEntry.moduleKey]
      ? CLUB_MODULE_META[moduleEntry.moduleKey].defaultEnabled
      : false,
    roleSummary: CLUB_MODULE_META[moduleEntry.moduleKey]
      ? CLUB_MODULE_META[moduleEntry.moduleKey].roleSummary
      : '',
  }));
}

async function getActiveModuleKeysForClub(clubId) {
  const modules = await getClubModules(clubId);
  return modules
    .filter((moduleEntry) => moduleEntry.enabled)
    .map((moduleEntry) => moduleEntry.moduleKey);
}

async function getClubModuleState(clubId) {
  const modules = await getClubModules(clubId);
  const activeModuleKeys = modules
    .filter((moduleEntry) => moduleEntry.enabled)
    .map((moduleEntry) => moduleEntry.moduleKey);

  return {
    modules,
    activeModuleKeys,
    isEnabled(moduleKey) {
      return activeModuleKeys.includes(moduleKey);
    },
  };
}

async function isClubModuleEnabled(clubId, moduleKey) {
  if (!clubId || !moduleKey) {
    return false;
  }

  return isModuleEnabledForClub(clubId, moduleKey);
}

function getClubModulePresets() {
  return Object.values(CLUB_MODULE_PRESETS).map((preset) => ({ ...preset }));
}

function resolveEnabledModuleKeys(enabledModuleKeys = [], presetKey = null) {
  if (presetKey && CLUB_MODULE_PRESETS[presetKey]) {
    return [...CLUB_MODULE_PRESETS[presetKey].moduleKeys];
  }

  return Array.isArray(enabledModuleKeys)
    ? enabledModuleKeys
    : (enabledModuleKeys ? [enabledModuleKeys] : []);
}

async function updateClubModules(clubId, enabledModuleKeys = [], presetKey = null) {
  const resolvedModuleKeys = resolveEnabledModuleKeys(enabledModuleKeys, presetKey);
  const enabledSet = new Set(resolvedModuleKeys);

  for (const moduleDefinition of DEFAULT_CLUB_MODULES) {
    // eslint-disable-next-line no-await-in-loop
    await setModuleEnabledForClub(
      clubId,
      moduleDefinition.key,
      enabledSet.has(moduleDefinition.key),
    );
  }

  return getClubModules(clubId);
}

module.exports = {
  getClubModules,
  getActiveModuleKeysForClub,
  getClubModuleState,
  isClubModuleEnabled,
  updateClubModules,
  CLUB_MODULE_META,
  CLUB_MODULE_PRESETS,
  getClubModulePresets,
  resolveEnabledModuleKeys,
};
