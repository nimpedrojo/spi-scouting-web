const express = require('express');

const reportRoutes = require('../../../routes/reportRoutes');
const assessmentRoutes = require('./assessmentRoutes');
const evaluationRoutes = require('./evaluationRoutes');
const playerProfileRoutes = require('./playerProfileRoutes');
const evaluationTemplateRoutes = require('./evaluationTemplateRoutes');
const seasonComparisonRoutes = require('./seasonComparisonRoutes');
const seasonForecastRoutes = require('./seasonForecastRoutes');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');

const router = express.Router();
const requireScoutingPlayers = requireModule(MODULE_KEYS.SCOUTING_PLAYERS);

router.use('/reports', requireScoutingPlayers, reportRoutes);
router.use('/', assessmentRoutes);
router.use('/', evaluationRoutes);
router.use('/', playerProfileRoutes);
router.use('/', evaluationTemplateRoutes);
router.use('/', seasonComparisonRoutes);
router.use('/', seasonForecastRoutes);

module.exports = router;
