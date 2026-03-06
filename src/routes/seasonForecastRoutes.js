const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const controller = require('../controllers/seasonForecastController');

const router = express.Router();

router.get('/season-forecast', ensureAdmin, controller.renderIndex);
router.get('/season-forecast/player/:id', ensureAdmin, controller.renderPlayer);
router.get('/season-forecast/team/:id', ensureAdmin, controller.renderTeam);

module.exports = router;
