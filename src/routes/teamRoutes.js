const express = require('express');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const teamController = require('../controllers/teamController');

const router = express.Router();

router.get('/', ensureAuth, teamController.renderIndex);
router.get('/new', ensureAdmin, teamController.renderNew);
router.get('/import/processiq', ensureAdmin, teamController.renderProcessIqImport);
router.post('/import/processiq/preview', ensureAdmin, teamController.previewProcessIqImport);
router.post('/import/processiq/confirm', ensureAdmin, teamController.confirmProcessIqImport);
router.post('/import-players/processiq', ensureAdmin, teamController.importProcessIqPlayersBulk);
router.post('/:id/import-players/processiq', ensureAdmin, teamController.importProcessIqPlayers);
router.post('/', ensureAdmin, teamController.create);
router.get('/:id', ensureAuth, teamController.renderShow);
router.get('/:id/edit', ensureAdmin, teamController.renderEdit);
router.post('/:id/update', ensureAdmin, teamController.update);
router.post('/:id/delete', ensureAdmin, teamController.remove);

module.exports = router;
