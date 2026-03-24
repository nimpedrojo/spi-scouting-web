const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const { renderAssessmentHub } = require('../controllers/assessmentHubController');

const router = express.Router();

router.get('/assessments', ensureAuth, renderAssessmentHub);

module.exports = router;
