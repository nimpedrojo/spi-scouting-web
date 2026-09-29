const express = require('express');
const multer = require('multer');
const { ensureAuth, ensureAdmin } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../controllers/playerLoadController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.pdf')) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_PLAYER_LOAD_IMPORT_FILE'));
  },
});

function uploadImportFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      req.flash('error', 'El archivo no puede superar los 5MB.');
    } else {
      req.flash('error', 'El archivo debe ser CSV, Excel o PDF.');
    }
    res.redirect('/player-load/import');
  });
}

router.use(ensureAuth, requireModule(MODULE_KEYS.PLAYER_LOAD));

router.get('/', controller.renderIndex);
router.get('/activities/new', ensureAdmin, controller.renderNewActivity);
router.post('/activities', ensureAdmin, controller.createActivity);
router.get('/import', ensureAdmin, controller.renderImportForm);
router.post('/import/preview', ensureAdmin, uploadImportFile, controller.previewImport);
router.post('/import/confirm', ensureAdmin, controller.confirmImport);
router.get('/activities/:id', controller.renderActivityShow);
router.get('/activities/:id/edit', ensureAdmin, controller.renderEditActivity);
router.post('/activities/:id/update', ensureAdmin, controller.updateActivity);
router.post('/activities/:id/delete', ensureAdmin, controller.removeActivity);

module.exports = router;
