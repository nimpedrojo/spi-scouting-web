const express = require('express');
const {
  getAllClubs,
  createClub,
  getClubById,
  updateClub,
  deleteClubDependencies,
  deleteClub,
} = require('../models/clubModel');
const { getAllUsers, deleteUser } = require('../models/userModel');
const { logAuditEvent } = require('../services/auditLogger');

const router = express.Router();

function ensureSuperAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'superadmin') {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

function getBasePath(req) {
  return req.baseUrl || '/clubs';
}

router.get('/', ensureSuperAdmin, async (req, res) => {
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

router.get('/new', ensureSuperAdmin, (req, res) => res.render('clubs/form', {
  pageTitle: 'Nuevo club',
  activeRoute: '/clubs',
  club: null,
  basePath: getBasePath(req),
  formAction: `${getBasePath(req)}`,
  submitLabel: 'Crear club',
}));

router.post('/', ensureSuperAdmin, async (req, res) => {
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

router.get('/:id/edit', ensureSuperAdmin, async (req, res) => {
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

router.post('/:id/update', ensureSuperAdmin, async (req, res) => {
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

router.post('/:id/delete', ensureSuperAdmin, async (req, res) => {
  try {
    const club = await getClubById(req.params.id);
    if (!club) {
      req.flash('error', 'El club indicado no existe.');
      return res.redirect(getBasePath(req));
    }

    await deleteClubDependencies({ clubId: club.id, clubName: club.name });
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

router.post('/bulk-delete', ensureSuperAdmin, async (req, res) => {
  let { clubIds } = req.body;

  if (!clubIds) {
    req.flash('error', 'No has seleccionado ningún club para borrar.');
    return res.redirect(getBasePath(req));
  }

  if (!Array.isArray(clubIds)) {
    clubIds = [clubIds];
  }

  try {
    const idsToDelete = clubIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const deletedClubIds = [];

    for (const clubId of idsToDelete) {
      // eslint-disable-next-line no-await-in-loop
      const club = await getClubById(clubId);
      if (!club) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await deleteClubDependencies({ clubId: club.id, clubName: club.name });
      // eslint-disable-next-line no-await-in-loop
      const users = await getAllUsers(club.name);
      for (const user of users) {
        // eslint-disable-next-line no-await-in-loop
        await deleteUser(user.id);
      }
      // eslint-disable-next-line no-await-in-loop
      await deleteClub(clubId);
      deletedClubIds.push(clubId);
    }

    if (deletedClubIds.length) {
      logAuditEvent(req, 'bulk_delete', 'club', {
        clubIds: deletedClubIds,
        deletedCount: deletedClubIds.length,
      });
      req.flash('success', 'Clubes seleccionados borrados correctamente.');
    } else {
      req.flash('error', 'No se ha borrado ningún club.');
    }
    return res.redirect(getBasePath(req));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error en borrado múltiple de clubes:', err);
    req.flash('error', 'Ha ocurrido un error al borrar los clubes seleccionados.');
    return res.redirect(getBasePath(req));
  }
});

module.exports = router;
