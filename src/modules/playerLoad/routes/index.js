const express = require('express');
const { ensureAuth, ensureAdmin } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../controllers/playerLoadController');

const router = express.Router();

router.use(ensureAuth, requireModule(MODULE_KEYS.PLAYER_LOAD));

router.get('/', controller.renderIndex);
router.get('/activities/new', ensureAdmin, controller.renderNewActivity);
router.post('/activities', ensureAdmin, controller.createActivity);
router.get('/activities/:id', controller.renderActivityShow);
router.get('/activities/:id/edit', ensureAdmin, controller.renderEditActivity);
router.post('/activities/:id/update', ensureAdmin, controller.updateActivity);
router.post('/activities/:id/delete', ensureAdmin, controller.removeActivity);

module.exports = router;
