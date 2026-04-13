const express = require('express');
const { ensureAuth } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../controllers/planningController');

const router = express.Router();

router.use(ensureAuth, requireModule(MODULE_KEYS.PLANNING));

router.get('/', controller.renderPlanningHome);

router.get('/plans/new', controller.renderNewSeasonPlan);
router.post('/plans', controller.createSeasonPlan);
router.get('/plans/:id', controller.renderSeasonPlanShow);
router.get('/plans/:id/edit', controller.renderEditSeasonPlan);
router.post('/plans/:id/update', controller.updateSeasonPlan);
router.post('/plans/:id/delete', controller.removeSeasonPlan);

router.get('/microcycles/new', controller.renderNewMicrocycle);
router.post('/microcycles', controller.createMicrocycle);
router.get('/microcycles/:id', controller.renderMicrocycleShow);
router.get('/microcycles/:id/edit', controller.renderEditMicrocycle);
router.post('/microcycles/:id/update', controller.updateMicrocycle);
router.post('/microcycles/:id/delete', controller.removeMicrocycle);

router.get('/sessions/new', controller.renderNewSession);
router.post('/sessions', controller.createSession);
router.get('/sessions/:id/edit', controller.renderEditSession);
router.post('/sessions/:id/update', controller.updateSession);
router.post('/sessions/:id/delete', controller.removeSession);

module.exports = router;
