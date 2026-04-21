const express = require('express');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const seasonRecommendationController = require('../controllers/seasonRecommendationController');

const router = express.Router();

router.post('/season-recommendations', ensureAdmin, seasonRecommendationController.createSeasonRecommendation);
router.put('/season-recommendations/:id', ensureAdmin, seasonRecommendationController.updateSeasonRecommendation);
router.get('/seasons/:id/recommendations', ensureAdmin, seasonRecommendationController.listSeasonRecommendations);

module.exports = router;
