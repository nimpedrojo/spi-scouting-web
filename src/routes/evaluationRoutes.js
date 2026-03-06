const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const controller = require('../controllers/evaluationController');

const router = express.Router();

router.get('/evaluations', ensureAdmin, controller.renderIndex);
router.get('/evaluations/new', ensureAdmin, controller.renderNew);
router.get('/evaluations/compare', ensureAdmin, controller.renderCompare);
router.post('/evaluations/compare', ensureAdmin, controller.submitCompare);
router.post('/evaluations', ensureAdmin, controller.create);
router.post('/evaluations/import', ensureAdmin, controller.upload.single('file'), controller.importMany);
router.get('/evaluations/:id', ensureAdmin, controller.renderShow);
router.get('/players/:id/evaluations', ensureAdmin, controller.renderPlayerHistory);

module.exports = router;
