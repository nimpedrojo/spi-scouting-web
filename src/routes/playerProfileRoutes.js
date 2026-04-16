const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const {
  renderProfile,
} = require('../controllers/playerProfileController');

const router = express.Router();

router.get('/players/:id', ensureAuth, renderProfile);

module.exports = router;
