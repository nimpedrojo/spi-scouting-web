const express = require('express');
const { ensureAdmin } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../../../controllers/seasonComparisonController');

const router = express.Router();
const requireScoutingPlayers = requireModule(MODULE_KEYS.SCOUTING_PLAYERS);

router.get('/season-comparison', ensureAdmin, requireScoutingPlayers, controller.renderIndex);
router.get('/season-comparison/player/:id', ensureAdmin, requireScoutingPlayers, controller.renderPlayer);
router.get('/season-comparison/team/:id', ensureAdmin, requireScoutingPlayers, controller.renderTeam);

module.exports = router;
