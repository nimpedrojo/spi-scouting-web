const express = require('express');
const controller = require('../controllers/accessRequestController');
const { requireRole } = require('../middleware/roleMiddleware');
const { requireCsrf, createRequestLimiter, privateResponse } = require('../middleware/accessRequestProtection');

const router = express.Router();
const publicLimiter = createRequestLimiter();
function guestOnly(req, res, next) {
  if (req.session.user) return res.redirect('/dashboard');
  return next();
}
router.use('/request-access', privateResponse, guestOnly);
router.get('/request-access', (req, res) => controller.renderForm(req, res));
router.get('/request-access/received', (_req, res) => res.render('accessRequests/received', { pageTitle: 'Solicitud recibida' }));
router.post('/request-access', publicLimiter, requireCsrf, controller.submit);
router.use('/admin/access-requests', privateResponse, requireRole('superadmin'));
router.get('/admin/access-requests', controller.list);
router.get('/admin/access-requests/:id', controller.detail);
router.post('/admin/access-requests/:id/status', requireCsrf, controller.review);
module.exports = router;
