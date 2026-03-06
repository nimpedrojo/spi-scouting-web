const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const {
  renderProfile,
  renderPdf,
  renderPdfPreview,
} = require('../controllers/playerProfileController');

const router = express.Router();

router.get('/players/:id', ensureAdmin, renderProfile);
router.get('/players/:id/pdf', ensureAdmin, renderPdf);
router.get('/players/:id/pdf/preview', ensureAdmin, renderPdfPreview);

module.exports = router;
