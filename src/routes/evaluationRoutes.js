const express = require('express');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const controller = require('../controllers/evaluationController');

const router = express.Router();

router.get('/evaluations', ensureAuth, controller.renderIndex);
router.get('/evaluations/new', ensureAuth, controller.renderNew);
router.get('/evaluations/compare', ensureAuth, controller.renderCompare);
router.post('/evaluations/compare', ensureAuth, controller.submitCompare);
router.post('/evaluations', ensureAuth, controller.create);
router.post('/evaluations/import', ensureAdmin, controller.upload.single('file'), controller.importMany);
router.get('/evaluations/:id', ensureAuth, controller.renderShow);
router.get('/players/:id/evaluations', ensureAuth, controller.renderPlayerHistory);

module.exports = router;
