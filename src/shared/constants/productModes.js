const PRODUCT_MODES = {
  SUITE: 'suite',
  PMV_PLAYER_TRACKING: 'pmv_player_tracking',
};

const PRODUCT_MODE_META = {
  [PRODUCT_MODES.SUITE]: {
    key: PRODUCT_MODES.SUITE,
    label: 'Suite completa',
    description: 'Experiencia modular completa de SoccerProcessIQ Suite.',
    productLabel: 'SoccerProcessIQ Suite',
    productSubtitle: 'Modular Football Club Platform',
    productSignature: 'by ProcessIQ',
    productWordmark: 'SoccerProcessIQ Suite',
    brandAccent: 'suite',
    logoAsset: '/img/soccerreport-logo.png',
    logoCompactAsset: '/img/soccerreport-logo.png',
    iconAsset: '/img/soccerreport-logo.png',
  },
  [PRODUCT_MODES.PMV_PLAYER_TRACKING]: {
    key: PRODUCT_MODES.PMV_PLAYER_TRACKING,
    label: 'PlayerTrack',
    description: 'Experiencia simplificada y vendible centrada en seguimiento de jugadores.',
    productLabel: 'PlayerTrack',
    productSubtitle: 'Seguimiento claro del jugador para futbol formativo',
    productSignature: 'by ProcessIQ',
    productWordmark: 'PlayerTrack by ProcessIQ',
    brandAccent: 'playertrack',
    logoAsset: '/img/playertrack-logo.svg',
    logoCompactAsset: '/img/playertrack-mark.svg',
    iconAsset: '/img/playertrack-icon.svg',
  },
};

const DEFAULT_PRODUCT_MODE = PRODUCT_MODES.SUITE;

function isValidProductMode(mode) {
  return Object.values(PRODUCT_MODES).includes(mode);
}

function normalizeProductMode(mode) {
  return isValidProductMode(mode) ? mode : DEFAULT_PRODUCT_MODE;
}

module.exports = {
  PRODUCT_MODES,
  PRODUCT_MODE_META,
  DEFAULT_PRODUCT_MODE,
  isValidProductMode,
  normalizeProductMode,
};
