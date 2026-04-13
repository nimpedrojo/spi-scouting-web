const express = require('express');
const { ensureAuth, ensureAdmin } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../../../controllers/evaluationController');

const router = express.Router();
const requireScoutingPlayers = requireModule(MODULE_KEYS.SCOUTING_PLAYERS);

router.get('/evaluations', ensureAuth, requireScoutingPlayers, controller.renderIndex);
router.get('/evaluations/new', ensureAuth, requireScoutingPlayers, controller.renderNew);
router.get('/evaluations/compare', ensureAuth, requireScoutingPlayers, controller.renderCompare);
router.post('/evaluations/compare', ensureAuth, requireScoutingPlayers, controller.submitCompare);
router.post('/evaluations', ensureAuth, requireScoutingPlayers, controller.create);
router.post(
  '/evaluations/import',
  ensureAdmin,
  requireScoutingPlayers,
  controller.upload.single('file'),
  controller.importMany,
);
router.get('/evaluations/:id', ensureAuth, requireScoutingPlayers, controller.renderShow);
router.get('/players/:id/evaluations', ensureAuth, requireScoutingPlayers, controller.renderPlayerHistory);

module.exports = router;
