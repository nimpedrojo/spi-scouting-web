const express = require('express');
const { ensureAdmin } = require('../middleware/auth');
const teamController = require('../controllers/teamController');

const router = express.Router();

router.get('/', ensureAdmin, teamController.renderIndex);
router.get('/new', ensureAdmin, teamController.renderNew);
router.post('/', ensureAdmin, teamController.create);
router.get('/:id', ensureAdmin, teamController.renderShow);
router.get('/:id/edit', ensureAdmin, teamController.renderEdit);
router.post('/:id/update', ensureAdmin, teamController.update);
router.post('/:id/delete', ensureAdmin, teamController.remove);

module.exports = router;
