const express = require('express');
const { ensureAuth } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const { renderAssessmentHub } = require('../../../controllers/assessmentHubController');

const router = express.Router();

router.get(
  '/assessments',
  ensureAuth,
  requireModule(MODULE_KEYS.SCOUTING_PLAYERS),
  renderAssessmentHub,
);

module.exports = router;
