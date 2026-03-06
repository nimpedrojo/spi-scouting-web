const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const controller = require('../controllers/evaluationTemplateController');

const router = express.Router();

router.get('/evaluation-templates', ensureAdmin, controller.renderIndex);
router.get('/evaluation-templates/new', ensureAdmin, controller.renderNew);
router.post('/evaluation-templates', ensureAdmin, controller.create);
router.get('/evaluation-templates/:id', ensureAdmin, controller.renderShow);
router.get('/evaluation-templates/:id/edit', ensureAdmin, controller.renderEdit);
router.post('/evaluation-templates/:id/update', ensureAdmin, controller.update);
router.post('/evaluation-templates/:id/delete', ensureAdmin, controller.remove);

module.exports = router;
