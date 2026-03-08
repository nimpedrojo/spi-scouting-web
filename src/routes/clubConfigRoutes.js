const express = require('express');

const {
  createTeam,
  updateTeamName,
  deleteTeam,
} = require('../models/clubTeamModel');
const {
  upsertRecommendation,
  updateRecommendation,
  deleteRecommendation,
} = require('../models/clubRecommendationModel');
const {
  resolveAdminClub,
  getClubAdminData,
  getClubAdminOptions,
} = require('../services/clubAdminService');

const router = express.Router();

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
      teams: data.legacyTeams,
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

router.post('/teams', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'El nombre de equipo es obligatorio.');
    return res.redirect('/admin/club');
  }

  try {
    await createTeam({ club: club.name, name: name.trim() });
    req.flash('success', 'Equipo creado correctamente.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear equipo de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al crear el equipo. Revisa que no esté duplicado.',
    );
  }
  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/teams/:id/rename', ensureAdmin, async (req, res) => {
  const club = await resolveAdminClub(req);
  if (!club) {
    req.flash(
      'error',
      'Debes configurar primero el club por defecto en tu cuenta.',
    );
    return res.redirect('/account');
  }

  const { id } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'El nombre de equipo es obligatorio.');
    return res.redirect('/admin/club');
  }

  try {
    const affected = await updateTeamName(id, club.name, name.trim());
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar el equipo.');
    } else {
      req.flash('success', 'Equipo actualizado correctamente.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al renombrar equipo de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al actualizar el equipo. Revisa que no esté duplicado.',
    );
  }

  return res.redirect(buildClubConfigRedirect(club));
});

router.post('/teams/:id/delete', ensureAdmin, async (req, res) => {
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
    const affected = await deleteTeam(id, club.name);
    if (!affected) {
      req.flash('error', 'No se ha podido borrar el equipo.');
    } else {
      req.flash('success', 'Equipo borrado correctamente.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar equipo de club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al borrar el equipo del club.',
    );
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
