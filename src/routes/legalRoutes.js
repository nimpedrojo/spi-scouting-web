const express = require('express');
const {
  renderPrivacy,
  renderLegalNotice,
} = require('../controllers/legalController');

const router = express.Router();

router.get('/privacy', renderPrivacy);
router.get('/legal', renderLegalNotice);

module.exports = router;
