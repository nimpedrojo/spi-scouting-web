const express = require('express');
const { ensureAuth } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const { renderPlanningHome } = require('../controllers/planningController');

const router = express.Router();

router.get('/', ensureAuth, requireModule(MODULE_KEYS.PLANNING), renderPlanningHome);

module.exports = router;
