const express = require('express');
const { ensureAuth } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const {
  renderProfile,
  renderPdf,
  renderPdfPreview,
} = require('../../../controllers/playerProfileController');

const router = express.Router();
const requireScoutingPlayers = requireModule(MODULE_KEYS.SCOUTING_PLAYERS);

router.get('/players/:id', ensureAuth, requireScoutingPlayers, renderProfile);
router.get('/players/:id/pdf', ensureAuth, requireScoutingPlayers, renderPdf);
router.get('/players/:id/pdf/preview', ensureAuth, requireScoutingPlayers, renderPdfPreview);

module.exports = router;
