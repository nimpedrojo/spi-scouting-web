const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const controller = require('../controllers/seasonForecastController');

const router = express.Router();

router.get('/season-forecast', ensureAdmin, controller.renderIndex);
router.post('/season-forecast/assign', ensureAdmin, controller.assignPlayer);
router.get('/season-forecast/player/:id', ensureAdmin, controller.renderPlayer);
router.get('/season-forecast/team/:id', ensureAdmin, controller.renderTeam);

module.exports = router;
