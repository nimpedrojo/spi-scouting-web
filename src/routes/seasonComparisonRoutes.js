const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const controller = require('../controllers/seasonComparisonController');

const router = express.Router();

router.get('/season-comparison', ensureAdmin, controller.renderIndex);
router.get('/season-comparison/player/:id', ensureAdmin, controller.renderPlayer);
router.get('/season-comparison/team/:id', ensureAdmin, controller.renderTeam);

module.exports = router;
