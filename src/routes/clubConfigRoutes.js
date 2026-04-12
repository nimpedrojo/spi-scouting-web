const express = require('express');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');

const {
  upsertRecommendation,
  updateRecommendation,
  deleteRecommendation,
} = require('../models/clubRecommendationModel');
const { updateClubBranding } = require('../models/clubModel');
const {
  resolveAdminClub,
  getClubAdminData,
  getClubAdminOptions,
} = require('../services/clubAdminService');

const router = express.Router();
const clubCrestsDir = path.join(__dirname, '..', 'public', 'uploads', 'clubs');

const crestUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, clubCrestsDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `club-crest-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_IMAGE_TYPE'));
  },
});

function buildClubConfigRedirect(club) {
  return club && club.id ? `/admin/club?club_id=${club.id}` : '/admin/club';
}

function ensureAdmin(req, res, next) {
  if (
    !req.session.user
    || (req.session.user.role !== 'admin'
      && req.session.user.role !== 'superadmin')
  ) {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

router.get('/', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta para acceder a la configuración del club.',
    );
    return res.redirect('/account');
  }

  try {
    const [data, clubOptions] = await Promise.all([
      getClubAdminData(club),
      getClubAdminOptions(req),
    ]);

    return res.render('club/config', {
      club: club.name,
      clubRecord: club,
      clubOptions,
      selectedClubId: club.id,
      users: data.users,
      players: data.players,
      reports: data.reports,
      recommendations: data.recommendations,
      v2Teams: data.v2Teams,
      seasons: data.seasons,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar configuración de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al cargar la configuración del club.',
    );
    return res.redirect('/dashboard');
  }
});

router.post('/branding', ensureAdmin, crestUpload.single('crest_file'), async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  const interfaceColorRaw = (req.body.interface_color || '').trim();
  const removeCrest = req.body.remove_crest === '1';
  const normalizedColor = interfaceColorRaw
    ? (interfaceColorRaw.startsWith('#') ? interfaceColorRaw.toUpperCase() : `#${interfaceColorRaw.toUpperCase()}`)
    : null;

  if (normalizedColor && !/^#[0-9A-F]{6}$/.test(normalizedColor)) {
    req.flash('error', 'El color principal debe estar en formato hexadecimal de 6 caracteres.');
    return res.redirect(buildClubConfigRedirect(club));
  }

  try {
    const crestPath = removeCrest
      ? null
      : (req.file ? `/uploads/clubs/${req.file.filename}` : undefined);

    await updateClubBranding(club.id, {
      interfaceColor: normalizedColor,
      crestPath,
    });

    if (req.context && req.context.club) {
      req.context.club.interface_color = normalizedColor;
      req.context.club.crest_path = crestPath === undefined ? req.context.club.crest_path : crestPath;
    }

    req.session.clubContext = null;
    req.flash('success', 'Branding del club actualizado correctamente.');
    return res.redirect(buildClubConfigRedirect(club));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar branding del club:', err);
    const message = err && err.message === 'INVALID_IMAGE_TYPE'
      ? 'El escudo debe ser una imagen válida.'
      : 'Ha ocurrido un error al guardar el branding del club.';
    req.flash('error', message);
    return res.redirect(buildClubConfigRedirect(club));
  }
});

router.post('/recommendations', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  const { year, options } = req.body;
  const yearNum = Number(year);
  if (!yearNum || Number.isNaN(yearNum)) {
    req.flash('error', 'El año debe ser un número válido.');
    return res.redirect('/admin/club');
  }

  const optionsText = (options || '').trim();
  if (!optionsText) {
    req.flash('error', 'Debes indicar al menos una opción de recomendación.');
    return res.redirect('/admin/club');
  }

  try {
    await upsertRecommendation({
      club: club.name,
      year: yearNum,
      options: optionsText,
    });
    req.flash('success', 'Recomendaciones actualizadas correctamente para ese año.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al guardar recomendaciones de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al guardar las recomendaciones.',
    );
  }

  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/recommendations/:id/edit', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  const { id } = req.params;
  const { year, options } = req.body;
  const yearNum = Number(year);
  if (!yearNum || Number.isNaN(yearNum)) {
    req.flash('error', 'El año debe ser un número válido.');
    return res.redirect('/admin/club');
  }

  const optionsText = (options || '').trim();
  if (!optionsText) {
    req.flash('error', 'Debes indicar al menos una opción de recomendación.');
    return res.redirect('/admin/club');
  }

  try {
    const affected = await updateRecommendation(id, club.name, {
      year: yearNum,
      options: optionsText,
    });
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar la fila de recomendaciones.');
    } else {
      req.flash('success', 'Recomendaciones actualizadas correctamente.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar recomendaciones de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al actualizar las recomendaciones.',
    );
  }

  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/recommendations/:id/delete', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  const { id } = req.params;

  try {
    const affected = await deleteRecommendation(id, club.name);
    if (!affected) {
      req.flash('error', 'No se ha podido borrar la fila de recomendaciones.');
    } else {
      req.flash('success', 'Fila de recomendaciones borrada correctamente.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar recomendaciones de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al borrar las recomendaciones.',
    );
  }

  return res.redirect(`/admin/club${club ? `?club_id=${club.id}` : ''}`);
});

module.exports = router;
