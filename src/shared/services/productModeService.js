const {
  getPlatformSettings,
  updatePlatformSettings,
} = require('../../core/models/platformSettingsModel');
const { updateClubProductMode } = require('../../models/clubModel');
const {
  PRODUCT_MODES,
  PRODUCT_MODE_META,
  DEFAULT_PRODUCT_MODE,
  normalizeProductMode,
} = require('../constants/productModes');

async function getPlatformProductSettings() {
  const settings = await getPlatformSettings();
  const defaultMode = normalizeProductMode(settings ? settings.default_product_mode : null);

  return {
    defaultMode,
    defaultModeMeta: PRODUCT_MODE_META[defaultMode],
    availableModes: Object.values(PRODUCT_MODE_META),
  };
}

async function setPlatformDefaultProductMode(productMode) {
  const normalizedMode = normalizeProductMode(productMode);
  await updatePlatformSettings({ defaultProductMode: normalizedMode });
  return getPlatformProductSettings();
}

async function setClubProductMode(clubId, productMode = null) {
  if (!clubId) {
    return 0;
  }

  const normalizedMode = productMode ? normalizeProductMode(productMode) : null;
  return updateClubProductMode(clubId, normalizedMode);
}

async function resolveEffectiveProductMode(club = null) {
  const platformSettings = await getPlatformProductSettings();
  const clubOverride = club && club.product_mode ? normalizeProductMode(club.product_mode) : null;
  const effectiveMode = clubOverride || platformSettings.defaultMode || DEFAULT_PRODUCT_MODE;

  return {
    globalMode: platformSettings.defaultMode,
    clubOverride,
    effectiveMode,
    effectiveMeta: PRODUCT_MODE_META[effectiveMode],
    availableModes: platformSettings.availableModes,
    isSuiteMode: effectiveMode === PRODUCT_MODES.SUITE,
    isPmvPlayerTracking: effectiveMode === PRODUCT_MODES.PMV_PLAYER_TRACKING,
  };
}

module.exports = {
  getPlatformProductSettings,
  setPlatformDefaultProductMode,
  setClubProductMode,
  resolveEffectiveProductMode,
};
