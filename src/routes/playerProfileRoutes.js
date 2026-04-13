const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const {
  renderProfile,
  renderPdf,
  renderPdfPreview,
} = require('../controllers/playerProfileController');

const router = express.Router();

router.get('/players/:id', ensureAuth, renderProfile);
router.get('/players/:id/pdf', ensureAuth, renderPdf);
router.get('/players/:id/pdf/preview', ensureAuth, renderPdfPreview);

module.exports = router;
