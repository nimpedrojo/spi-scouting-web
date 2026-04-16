const express = require('express');
const { ensureAdmin } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../../../controllers/evaluationTemplateController');

const router = express.Router();
const requireScoutingPlayers = requireModule(MODULE_KEYS.SCOUTING_PLAYERS);

router.get('/evaluation-templates', ensureAdmin, requireScoutingPlayers, controller.renderIndex);
router.get('/evaluation-templates/new', ensureAdmin, requireScoutingPlayers, controller.renderNew);
router.post('/evaluation-templates', ensureAdmin, requireScoutingPlayers, controller.create);
router.get('/evaluation-templates/:id', ensureAdmin, requireScoutingPlayers, controller.renderShow);
router.get('/evaluation-templates/:id/edit', ensureAdmin, requireScoutingPlayers, controller.renderEdit);
router.post('/evaluation-templates/:id/update', ensureAdmin, requireScoutingPlayers, controller.update);
router.post('/evaluation-templates/:id/delete', ensureAdmin, requireScoutingPlayers, controller.remove);

module.exports = router;
