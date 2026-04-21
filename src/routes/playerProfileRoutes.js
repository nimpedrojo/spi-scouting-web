const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const {
  renderProfile,
} = require('../controllers/playerProfileController');
const seasonRecommendationController = require('../controllers/seasonRecommendationController');

const router = express.Router();

router.get('/players/:id/recommendations', ensureAuth, seasonRecommendationController.listPlayerRecommendations);
router.get('/players/:id', ensureAuth, renderProfile);

module.exports = router;
