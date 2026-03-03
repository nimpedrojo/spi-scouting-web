const express = require('express');
const {
  getAllClubs,
  createClub,
  getClubById,
  updateClub,
  deleteClub,
} = require('../models/clubModel');

const router = express.Router();

function ensureSuperAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'superadmin') {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

// Listado de clubes
router.get('/', ensureSuperAdmin, async (req, res) => {
  try {
    const clubs = await getAllClubs();
    return res.render('clubs/list', { clubs });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al obtener clubes:', err);
    req.flash('error', 'Ha ocurrido un error al cargar los clubes.');
    return res.redirect('/');
  }
});

// Formulario nuevo club
router.get('/new', ensureSuperAdmin, (req, res) => {
  res.render('clubs/new');
});

router.post('/new', ensureSuperAdmin, async (req, res) => {
  const { name, code } = req.body;

  if (!name || !code) {
    req.flash('error', 'Nombre y código son obligatorios.');
    return res.redirect('/admin/clubs/new');
  }

  try {
    await createClub({ name, code });
    req.flash('success', 'Club creado correctamente.');
    return res.redirect('/admin/clubs');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear club:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al crear el club. Revisa que el código no esté duplicado.',
    );
    return res.redirect('/admin/clubs/new');
  }
});

// Formulario edición de club
router.get('/:id/edit', ensureSuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const club = await getClubById(id);
    if (!club) {
      req.flash('error', 'El club indicado no existe.');
      return res.redirect('/admin/clubs');
    }
    return res.render('clubs/edit', { club });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar club para edición:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el club.');
    return res.redirect('/admin/clubs');
  }
});

router.post('/:id/edit', ensureSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'El nombre del club es obligatorio.');
    return res.redirect(`/admin/clubs/${id}/edit`);
  }

  try {
    const affected = await updateClub(id, { name: name.trim() });
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar el club.');
      return res.redirect(`/admin/clubs/${id}/edit`);
    }
    req.flash('success', 'Club actualizado correctamente.');
    return res.redirect('/admin/clubs');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar club:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar el club.');
    return res.redirect(`/admin/clubs/${id}/edit`);
  }
});

// Borrar club
router.post('/:id/delete', ensureSuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const affected = await deleteClub(id);
    if (!affected) {
      req.flash('error', 'No se ha podido borrar el club.');
    } else {
      req.flash('success', 'Club borrado correctamente.');
    }
    return res.redirect('/admin/clubs');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar club:', err);
    req.flash('error', 'Ha ocurrido un error al borrar el club.');
    return res.redirect('/admin/clubs');
  }
});

module.exports = router;
