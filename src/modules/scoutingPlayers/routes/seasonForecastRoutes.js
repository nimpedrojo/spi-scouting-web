const express = require('express');
const { ensureAdmin } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../../../controllers/seasonForecastController');

const router = express.Router();
const requireScoutingPlayers = requireModule(MODULE_KEYS.SCOUTING_PLAYERS);

router.get('/season-forecast', ensureAdmin, requireScoutingPlayers, controller.renderIndex);
router.get('/season-forecast/player/:id', ensureAdmin, requireScoutingPlayers, controller.renderPlayer);
router.get('/season-forecast/team/:id', ensureAdmin, requireScoutingPlayers, controller.renderTeam);

module.exports = router;
