const express = require('express');
const {
  getAllClubs,
  createClub,
  getClubById,
  updateClub,
  deleteClub,
} = require('../models/clubModel');
const { getAllUsers, deleteUser } = require('../models/userModel');

const router = express.Router();

function ensureAdmin(req, res, next) {
  if (
    !req.session.user
    || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')
  ) {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

function getBasePath(req) {
  return req.baseUrl || '/clubs';
}

router.get('/', ensureAdmin, async (req, res) => {
  try {
    const clubs = await getAllClubs();
    return res.render('clubs/index', {
      pageTitle: 'Clubes',
      activeRoute: '/clubs',
      clubs,
      basePath: getBasePath(req),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al obtener clubes:', err);
    req.flash('error', 'Ha ocurrido un error al cargar los clubes.');
    return res.redirect('/');
  }
});

router.get('/new', ensureAdmin, (req, res) => res.render('clubs/form', {
  pageTitle: 'Nuevo club',
  activeRoute: '/clubs',
  club: null,
  basePath: getBasePath(req),
  formAction: `${getBasePath(req)}`,
  submitLabel: 'Crear club',
}));

router.post('/', ensureAdmin, async (req, res) => {
  const { name, code } = req.body;

  if (!name || !code) {
    req.flash('error', 'Nombre y código son obligatorios.');
    return res.redirect(`${getBasePath(req)}/new`);
  }

  try {
    await createClub({ name: name.trim(), code: code.trim() });
    req.flash('success', 'Club creado correctamente.');
    return res.redirect(getBasePath(req));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear club:', err);
    req.flash('error', 'Ha ocurrido un error al crear el club. Revisa que el código no esté duplicado.');
    return res.redirect(`${getBasePath(req)}/new`);
  }
});

router.get('/:id/edit', ensureAdmin, async (req, res) => {
  try {
    const club = await getClubById(req.params.id);
    if (!club) {
      req.flash('error', 'El club indicado no existe.');
      return res.redirect(getBasePath(req));
    }

    return res.render('clubs/form', {
      pageTitle: `Editar ${club.name}`,
      activeRoute: '/clubs',
      club,
      basePath: getBasePath(req),
      formAction: `${getBasePath(req)}/${club.id}/update`,
      submitLabel: 'Guardar cambios',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar club para edición:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el club.');
    return res.redirect(getBasePath(req));
  }
});

router.post('/:id/update', ensureAdmin, async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'El nombre del club es obligatorio.');
    return res.redirect(`${getBasePath(req)}/${req.params.id}/edit`);
  }

  try {
    const affected = await updateClub(req.params.id, { name: name.trim() });
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar el club.');
      return res.redirect(`${getBasePath(req)}/${req.params.id}/edit`);
    }
    req.flash('success', 'Club actualizado correctamente.');
    return res.redirect(getBasePath(req));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar club:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar el club.');
    return res.redirect(`${getBasePath(req)}/${req.params.id}/edit`);
  }
});

router.post('/:id/delete', ensureAdmin, async (req, res) => {
  try {
    const club = await getClubById(req.params.id);
    if (!club) {
      req.flash('error', 'El club indicado no existe.');
      return res.redirect(getBasePath(req));
    }

    const users = await getAllUsers(club.name);
    for (const user of users) {
      // eslint-disable-next-line no-await-in-loop
      await deleteUser(user.id);
    }

    const affected = await deleteClub(req.params.id);
    if (!affected) {
      req.flash('error', 'No se ha podido borrar el club.');
    } else {
      req.flash('success', 'Club borrado correctamente.');
    }
    return res.redirect(getBasePath(req));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar club:', err);
    req.flash('error', 'Ha ocurrido un error al borrar el club.');
    return res.redirect(getBasePath(req));
  }
});

module.exports = router;
