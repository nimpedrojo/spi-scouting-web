const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { ensureAuth } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../controllers/planningController');
const { planningTaskImagesDir } = require('../services/planningTaskAssetService');

const router = express.Router();

fs.mkdirSync(planningTaskImagesDir, { recursive: true });

const taskImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, planningTaskImagesDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `planning-task-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }

    cb(new Error('INVALID_IMAGE_TYPE'));
  },
});

function buildTaskImageRedirect(req) {
  if (req.params && req.params.id) {
    return `/planning/tasks/${req.params.id}/edit?session_id=${encodeURIComponent(req.body.session_id || req.query.session_id || '')}`;
  }

  return `/planning/tasks/new?session_id=${encodeURIComponent(req.body.session_id || req.query.session_id || '')}`;
}

function uploadTaskImage(req, res, next) {
  taskImageUpload.single('explanatory_image_file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      req.flash('error', 'La imagen explicativa no puede superar los 4MB.');
    } else if (error.message === 'INVALID_IMAGE_TYPE') {
      req.flash('error', 'La imagen explicativa debe ser una imagen válida.');
    } else {
      req.flash('error', 'No se ha podido procesar la imagen explicativa.');
    }

    res.redirect(buildTaskImageRedirect(req));
  });
}

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
router.post('/microcycles/:id/duplicate', controller.duplicateMicrocycle);
router.post('/microcycles/:id/delete', controller.removeMicrocycle);

router.get('/sessions/new', controller.renderNewSession);
router.post('/sessions', controller.createSession);
router.get('/sessions/:id', controller.renderSessionShow);
router.get('/sessions/:id/edit', controller.renderEditSession);
router.post('/sessions/:id/update', controller.updateSession);
router.post('/sessions/:id/delete', controller.removeSession);

router.get('/tasks/new', controller.renderNewTask);
router.post('/tasks', uploadTaskImage, controller.createTask);
router.get('/tasks/:id/edit', controller.renderEditTask);
router.post('/tasks/:id/update', uploadTaskImage, controller.updateTask);
router.post('/tasks/:id/delete', controller.removeTask);

router.get('/templates/new', controller.renderNewTemplate);
router.post('/templates', controller.createTemplate);
router.post('/templates/:id/delete', controller.removeTemplate);

module.exports = router;
