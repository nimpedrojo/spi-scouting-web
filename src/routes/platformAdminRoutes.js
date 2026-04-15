const express = require('express');
const { requireRole } = require('../middleware/roleMiddleware');
const { getAllClubs } = require('../models/clubModel');
const { getAllUsers } = require('../models/userModel');
const {
  getPlatformProductSettings,
  setPlatformDefaultProductMode,
} = require('../shared/services/productModeService');
const { isValidProductMode } = require('../shared/constants/productModes');

const router = express.Router();

router.get('/', requireRole('superadmin'), async (req, res) => {
  try {
    const [platformSettings, clubs, users] = await Promise.all([
      getPlatformProductSettings(),
      getAllClubs(),
      getAllUsers(),
    ]);

    return res.render('platform/config', {
      pageTitle: 'Administración de plataforma',
      platformSettings,
      stats: {
        clubs: clubs.length,
        users: users.length,
        admins: users.filter((user) => user.role === 'admin').length,
        superadmins: users.filter((user) => user.role === 'superadmin').length,
      },
      clubs: clubs.slice(0, 8),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error loading platform admin page', error);
    req.flash('error', 'Ha ocurrido un error al cargar la administración de plataforma.');
    return res.redirect('/dashboard');
  }
});

router.post('/product-mode', requireRole('superadmin'), async (req, res) => {
  const productMode = req.body && req.body.default_product_mode
    ? String(req.body.default_product_mode).trim()
    : '';

  if (!isValidProductMode(productMode)) {
    req.flash('error', 'El modo de producto seleccionado no es válido.');
    return res.redirect('/admin/platform');
  }

  try {
    await setPlatformDefaultProductMode(productMode);
    req.flash('success', 'Modo de producto global actualizado correctamente.');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating platform product mode', error);
    req.flash('error', 'Ha ocurrido un error al guardar el modo global de producto.');
  }

  return res.redirect('/admin/platform');
});

module.exports = router;
