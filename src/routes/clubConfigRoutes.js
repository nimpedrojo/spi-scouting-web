const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');

const {
  upsertRecommendation,
  updateRecommendation,
  deleteRecommendation,
} = require('../models/clubRecommendationModel');
const { updateClubBranding } = require('../models/clubModel');
const { updateClubModules } = require('../shared/services/clubModuleService');
const { setClubProductMode } = require('../shared/services/productModeService');
const {
  resolveAdminClub,
  getClubAdminData,
  getClubAdminOptions,
} = require('../services/clubAdminService');
const {
  createSeasonForClub,
  activateSeasonForClub,
} = require('../services/seasonAdminService');

const router = express.Router();
const clubCrestsDir = path.join(__dirname, '..', 'public', 'uploads', 'clubs');

fs.mkdirSync(clubCrestsDir, { recursive: true });

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

function uploadClubCrest(req, res, next) {
  crestUpload.single('crest_file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    const clubId = req.body && req.body.club_id ? req.body.club_id : null;
    const fallbackClub = clubId ? { id: clubId } : null;

    if (err.code === 'LIMIT_FILE_SIZE') {
      req.flash('error', 'El escudo no puede superar los 2MB.');
    } else if (err.message === 'INVALID_IMAGE_TYPE') {
      req.flash('error', 'El escudo debe ser una imagen válida.');
    } else {
      req.flash('error', 'No se ha podido procesar el archivo del escudo.');
    }

    res.redirect(buildClubConfigRedirect(fallbackClub));
  });
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
  const isSuperAdmin = req.session.user && req.session.user.role === 'superadmin';

  if (!club && !isSuperAdmin) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta para acceder a la configuración del club.',
    );
    return res.redirect('/account');
  }

  try {
    const [data, clubOptions] = await Promise.all([
      club ? getClubAdminData(club) : Promise.resolve(null),
      getClubAdminOptions(req),
    ]);

    return res.render('club/config', {
      club: club ? club.name : 'Selecciona un club',
      clubRecord: club,
      clubOptions,
      selectedClubId: club ? club.id : null,
      users: data ? data.users : [],
      players: data ? data.players : [],
      reports: data ? data.reports : [],
      recommendations: data ? data.recommendations : [],
      v2Teams: data ? data.v2Teams : [],
      seasons: data ? data.seasons : [],
      nextSeasonSuggestion: data ? data.nextSeasonSuggestion : null,
      modules: data ? data.modules : [],
      moduleSummary: data ? data.moduleSummary : null,
      modulePresets: data ? data.modulePresets : [],
      productMode: data ? data.productMode : null,
      platformProductSettings: data ? data.platformProductSettings : null,
      requiresClubSelection: !club,
      isSuperAdmin,
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

router.post('/branding', ensureAdmin, uploadClubCrest, async (req, res) => {
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

router.post('/modules', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  try {
    await updateClubModules(club.id, req.body.module_keys, req.body.module_preset || null);
    req.session.clubContext = null;

    const message = req.body.module_preset
      ? 'Preset de módulos aplicado correctamente.'
      : 'Módulos del club actualizados correctamente.';
    req.flash('success', message);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar módulos del club:', err);
    req.flash('error', 'Ha ocurrido un error al guardar la configuración de módulos.');
  }

  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/product-mode', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club que quieres administrar.',
    );
    return res.redirect('/admin/club');
  }

  const selectedMode = req.body && req.body.product_mode
    ? String(req.body.product_mode).trim()
    : '';
  const overrideMode = selectedMode === 'inherit' ? null : selectedMode;

  try {
    await setClubProductMode(club.id, overrideMode);
    req.session.clubContext = null;
    req.flash('success', 'Modo de producto del club actualizado correctamente.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar modo de producto del club:', err);
    req.flash('error', 'Ha ocurrido un error al guardar el modo de producto del club.');
  }

  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/seasons', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club que quieres administrar.',
    );
    return res.redirect('/admin/club');
  }

  try {
    const result = await createSeasonForClub(club.id, {
      name: req.body && req.body.name ? req.body.name : '',
      activate: req.body && req.body.activate_new_season === '1',
      copyStructureFromSeasonId: req.body && req.body.copy_structure_from_season_id
        ? req.body.copy_structure_from_season_id
        : '',
    });

    if (result.errors && result.errors.length) {
      req.flash('error', result.errors.join(' '));
      return res.redirect(buildClubConfigRedirect(club));
    }

    req.session.clubContext = null;
    const summary = result.copiedTeams
      ? `Temporada creada correctamente. Equipos copiados: ${result.copiedTeams}.`
      : 'Temporada creada correctamente.';
    req.flash('success', summary);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear temporada del club:', err);
    req.flash('error', 'Ha ocurrido un error al crear la temporada.');
  }

  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/seasons/:id/activate', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club que quieres administrar.',
    );
    return res.redirect('/admin/club');
  }

  try {
    const result = await activateSeasonForClub(club.id, req.params.id);
    if (result.errors && result.errors.length) {
      req.flash('error', result.errors.join(' '));
      return res.redirect(buildClubConfigRedirect(club));
    }

    req.session.clubContext = null;
    req.flash('success', `Temporada ${result.season.name} activada correctamente.`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al activar temporada del club:', err);
    req.flash('error', 'Ha ocurrido un error al activar la temporada.');
  }

  return res.redirect(buildClubConfigRedirect(club));
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
