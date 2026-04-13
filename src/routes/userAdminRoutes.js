const express = require('express');
const bcrypt = require('bcryptjs');
const {
  getAllUsers,
  updateUserRole,
  deleteUser,
  findUserById,
  updateUserAccount,
  countAdminsByClub,
  createUser,
  findUserByEmail,
} = require('../models/userModel');
const { getAllClubs, getClubById } = require('../models/clubModel');
const { findTeamById } = require('../models/teamModel');
const { getDefaultTeamOptionsForClub } = require('../services/teamService');

const router = express.Router();

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

// Listado de usuarios registrados
router.get('/', ensureAdmin, async (req, res) => {
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubFilter = isSuperAdmin ? null : req.session.user.default_club || null;
    const users = await getAllUsers(clubFilter);
    const visibleUsers = isSuperAdmin
      ? users
      : users.filter((user) => user.role !== 'superadmin');
    return res.render('users/list', { users: visibleUsers, currentUser: req.session.user });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al obtener usuarios:', err);
    req.flash('error', 'Ha ocurrido un error al cargar los usuarios.');
    return res.redirect('/');
  }
});

router.get('/new', ensureAdmin, async (req, res) => {
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const clubs = isSuperAdmin
      ? await getAllClubs()
      : (req.session.user.default_club ? [{ id: req.session.clubId || null, name: req.session.user.default_club }] : []);
    const requestedClubId = req.query.club_id ? String(req.query.club_id) : '';
    const defaultClubId = isSuperAdmin
      ? requestedClubId
      : (req.session.clubId ? String(req.session.clubId) : '');
    const teams = defaultClubId
      ? await getDefaultTeamOptionsForClub(defaultClubId)
      : [];

    return res.render('users/form', {
      pageTitle: 'Nuevo usuario',
      user: null,
      teams,
      clubs,
      selectedClubId: defaultClubId,
      formAction: '/admin/users',
      submitLabel: 'Crear usuario',
      isSuperAdmin,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar formulario de usuario:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el formulario.');
    return res.redirect('/admin/users');
  }
});

router.post('/', ensureAdmin, async (req, res) => {
  const {
    name,
    email,
    password,
    role = 'user',
    club_id,
    default_team_id,
  } = req.body;

  if (!name || !email || !password) {
    req.flash('error', 'Nombre, email y contraseña son obligatorios.');
    return res.redirect('/admin/users/new');
  }

  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const requestedRole = role && role.trim() ? role.trim() : 'user';
    const isGlobalSuperAdminTarget = requestedRole === 'superadmin';

    if (!isSuperAdmin && requestedRole !== 'user') {
      req.flash('error', 'Solo un superadmin puede crear usuarios administradores.');
      return res.redirect('/admin/users/new');
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      req.flash('error', 'Ya existe un usuario con ese email.');
      return res.redirect('/admin/users/new');
    }

    const selectedClubId = isGlobalSuperAdminTarget ? null : (club_id ? Number(club_id) : null);
    let assignedClub = null;
    if (selectedClubId) {
      assignedClub = await getClubById(selectedClubId);
      if (!assignedClub) {
        req.flash('error', 'El club seleccionado no es válido.');
        return res.redirect('/admin/users/new');
      }
      if (!isSuperAdmin && assignedClub.name !== req.session.user.default_club) {
        req.flash('error', 'No puedes asignar usuarios a otro club.');
        return res.redirect('/admin/users/new');
      }
    } else if (!isSuperAdmin && req.session.user.default_club) {
      assignedClub = await getClubById(req.session.clubId);
    }

    const defaultClub = assignedClub ? assignedClub.name : null;
    let defaultTeam = null;
    let defaultTeamId = isGlobalSuperAdminTarget
      ? null
      : (default_team_id && default_team_id.trim() ? default_team_id.trim() : null);
    if (defaultTeamId) {
      const selectedTeam = await findTeamById(defaultTeamId);
      if (!selectedTeam || !assignedClub || selectedTeam.club_id !== assignedClub.id) {
        req.flash('error', 'El equipo por defecto debe pertenecer a Plantillas del club seleccionado.');
        return res.redirect('/admin/users/new');
      }
      defaultTeam = selectedTeam.name;
      defaultTeamId = selectedTeam.id;
    }

    const userId = await createUser({
      name: name.trim(),
      email: email.trim(),
      password,
      role: isSuperAdmin ? requestedRole : 'user',
      clubId: assignedClub ? assignedClub.id : null,
      defaultClub,
      defaultTeam,
      defaultTeamId,
    });

    req.flash('success', 'Usuario creado correctamente.');
    return res.redirect(`/admin/users/${userId}/edit`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al crear usuario:', err);
    req.flash('error', 'Ha ocurrido un error al crear el usuario.');
    return res.redirect('/admin/users/new');
  }
});

// Cambiar rol de un usuario
router.post('/:id/role', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const isSuperAdmin = req.session.user.role === 'superadmin';
  const validRoles = isSuperAdmin ? ['user', 'admin', 'superadmin'] : ['user'];

  if (!validRoles.includes(role)) {
    req.flash('error', 'Rol no válido.');
    return res.redirect('/admin/users');
  }

  try {
    const targetUser = await findUserById(id);

    if (!targetUser) {
      req.flash('error', 'Usuario no encontrado.');
      return res.redirect('/admin/users');
    }

    // Garantizar que no se queda el club sin admins
    if (
      targetUser.role === 'admin'
      && role !== 'admin'
      && targetUser.default_club
    ) {
      const totalAdmins = await countAdminsByClub(targetUser.default_club);
      if (totalAdmins <= 1) {
        req.flash(
          'error',
          'No puedes cambiar el rol de este usuario porque dejarías al club sin ningún administrador.',
        );
        return res.redirect('/admin/users');
      }
    }

    if (!isSuperAdmin) {
      if (targetUser.role === 'superadmin') {
        req.flash('error', 'No puedes modificar un usuario superadmin.');
        return res.redirect('/admin/users');
      }

      if (
        req.session.user.default_club
        && targetUser.default_club
        && targetUser.default_club !== req.session.user.default_club
      ) {
        req.flash('error', 'No puedes modificar usuarios de otro club.');
        return res.redirect('/admin/users');
      }
    }

    // Evitar que un admin se quite a sí mismo todos los permisos por accidente
    if (Number(id) === req.session.user.id && role !== 'admin') {
      req.flash(
        'error',
        'No puedes cambiar tu propio rol a un perfil sin permisos de administrador.',
      );
      return res.redirect('/admin/users');
    }

    await updateUserRole(id, role);
    req.flash('success', 'Rol actualizado correctamente.');
    return res.redirect('/admin/users');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar rol de usuario:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar el rol.');
    return res.redirect('/admin/users');
  }
});

// Borrar usuario
router.post('/:id/delete', ensureAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const targetUser = await findUserById(id);

    if (!targetUser) {
      req.flash('error', 'Usuario no encontrado.');
      return res.redirect('/admin/users');
    }

    if (!isSuperAdmin) {
      if (targetUser.role === 'superadmin') {
        req.flash('error', 'No puedes borrar un usuario superadmin.');
        return res.redirect('/admin/users');
      }

      if (
        req.session.user.default_club
        && targetUser.default_club
        && targetUser.default_club !== req.session.user.default_club
      ) {
        req.flash('error', 'No puedes borrar usuarios de otro club.');
        return res.redirect('/admin/users');
      }
    }

    // Garantizar que no se queda el club sin admins
    if (targetUser.role === 'admin' && targetUser.default_club) {
      const totalAdmins = await countAdminsByClub(targetUser.default_club);
      if (totalAdmins <= 1) {
        req.flash(
          'error',
          'No puedes borrar este usuario porque dejarías al club sin ningún administrador.',
        );
        return res.redirect('/admin/users');
      }
    }
    if (Number(id) === req.session.user.id) {
      req.flash('error', 'No puedes borrar tu propio usuario.');
      return res.redirect('/admin/users');
    }

    await deleteUser(id);
    req.flash('success', 'Usuario borrado correctamente.');
    return res.redirect('/admin/users');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar usuario:', err);
    req.flash('error', 'Ha ocurrido un error al borrar el usuario.');
    return res.redirect('/admin/users');
  }
});

// Borrado múltiple de usuarios
router.post('/bulk-delete', ensureAdmin, async (req, res) => {
  let { userIds } = req.body;

  if (!userIds) {
    req.flash('error', 'No has seleccionado ningún usuario para borrar.');
    return res.redirect('/admin/users');
  }

  if (!Array.isArray(userIds)) {
    userIds = [userIds];
  }

  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const idsToDelete = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const rawId of userIds) {
      const userId = Number(rawId);
      if (!Number.isInteger(userId) || userId === req.session.user.id) {
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const targetUser = await findUserById(userId);
      if (!targetUser) {
        // eslint-disable-next-line no-continue
        continue;
      }

      if (!isSuperAdmin) {
        if (targetUser.role === 'superadmin') {
          // eslint-disable-next-line no-continue
          continue;
        }

        if (
          req.session.user.default_club
          && targetUser.default_club
          && targetUser.default_club !== req.session.user.default_club
        ) {
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      if (targetUser.role === 'admin' && targetUser.default_club) {
        // eslint-disable-next-line no-await-in-loop
        const totalAdmins = await countAdminsByClub(targetUser.default_club);
        if (totalAdmins <= 1) {
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      idsToDelete.push(userId);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const id of idsToDelete) {
      // eslint-disable-next-line no-await-in-loop
      await deleteUser(id);
    }

    if (idsToDelete.length) {
      req.flash('success', 'Usuarios seleccionados borrados correctamente.');
    } else {
      req.flash(
        'error',
        'No se ha borrado ningún usuario (no puedes borrar tu propio usuario).',
      );
    }

    return res.redirect('/admin/users');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error en borrado múltiple de usuarios:', err);
    req.flash('error', 'Ha ocurrido un error al borrar los usuarios.');
    return res.redirect('/admin/users');
  }
});

// Formulario de edición de usuario (datos básicos y configuraciones)
router.get('/:id/edit', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const user = await findUserById(id);
    if (!user) {
      req.flash('error', 'Usuario no encontrado.');
      return res.redirect('/admin/users');
    }
    if (!isSuperAdmin) {
      if (user.role === 'superadmin') {
        req.flash('error', 'No puedes editar un usuario superadmin.');
        return res.redirect('/admin/users');
      }

      if (
        req.session.user.default_club
        && user.default_club
        && user.default_club !== req.session.user.default_club
      ) {
        req.flash('error', 'No puedes editar usuarios de otro club.');
        return res.redirect('/admin/users');
      }
    }
    const clubs = isSuperAdmin
      ? await getAllClubs()
      : (req.session.user.default_club ? [{ id: req.session.clubId || null, name: req.session.user.default_club }] : []);
    const requestedClubId = req.query.club_id ? String(req.query.club_id) : '';
    const effectiveClubId = isSuperAdmin
      ? (requestedClubId || (user.club_id ? String(user.club_id) : ''))
      : (user.club_id ? String(user.club_id) : '');
    const uniqueTeams = effectiveClubId
      ? await getDefaultTeamOptionsForClub(effectiveClubId)
      : [];

    return res.render('users/form', {
      pageTitle: 'Editar usuario',
      user,
      teams: uniqueTeams,
      clubs,
      selectedClubId: effectiveClubId,
      formAction: `/admin/users/${user.id}/edit`,
      submitLabel: 'Guardar cambios',
      isSuperAdmin,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar usuario para edición:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el usuario.');
    return res.redirect('/admin/users');
  }
});

router.post('/:id/edit', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    club_id,
    default_club,
    default_team_id,
    new_password,
  } = req.body;

  if (!name || !email) {
    req.flash('error', 'Nombre y email son obligatorios.');
    return res.redirect(`/admin/users/${id}/edit`);
  }

  try {
    const isSuperAdmin = req.session.user.role === 'superadmin';
    const targetUser = await findUserById(id);
    if (!targetUser) {
      req.flash('error', 'Usuario no encontrado.');
      return res.redirect('/admin/users');
    }

    let selectedClub = null;
    if (club_id) {
      selectedClub = await getClubById(Number(club_id));
      if (!selectedClub) {
        req.flash('error', 'El club seleccionado no es válido.');
        return res.redirect(`/admin/users/${id}/edit`);
      }
      if (!isSuperAdmin && selectedClub.name !== req.session.user.default_club) {
        req.flash('error', 'No puedes asignar usuarios a otro club.');
        return res.redirect(`/admin/users/${id}/edit`);
      }
    }

    let defaultClubValue = selectedClub
      ? selectedClub.name
      : (default_club && default_club.trim() ? default_club.trim() : null);
    let defaultTeamValue = null;
    let defaultTeamIdValue = default_team_id && default_team_id.trim()
      ? default_team_id.trim()
      : null;

    if (selectedClub && defaultTeamIdValue) {
      const selectedTeam = await findTeamById(defaultTeamIdValue);
      if (!selectedTeam || selectedTeam.club_id !== selectedClub.id) {
        req.flash(
          'error',
          'El equipo por defecto debe ser uno de los equipos v2 del club seleccionado.',
        );
        return res.redirect(`/admin/users/${id}/edit`);
      }
      defaultTeamValue = selectedTeam.name;
      defaultTeamIdValue = selectedTeam.id;
    }

    let passwordHash = null;
    if (new_password && new_password.trim()) {
      if (new_password.length < 8) {
        req.flash(
          'error',
          'La nueva contraseña debe tener al menos 8 caracteres.',
        );
        return res.redirect(`/admin/users/${id}/edit`);
      }
      passwordHash = await bcrypt.hash(new_password, 10);
    }

    const affected = await updateUserAccount(id, {
      name,
      email,
      clubId: targetUser.role === 'superadmin' ? null : (selectedClub ? selectedClub.id : null),
      defaultClub: targetUser.role === 'superadmin' ? null : defaultClubValue,
      defaultTeam: targetUser.role === 'superadmin' ? null : defaultTeamValue,
      defaultTeamId: targetUser.role === 'superadmin' ? null : defaultTeamIdValue,
      passwordHash,
    });
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar el usuario.');
      return res.redirect(`/admin/users/${id}/edit`);
    }

    req.flash('success', 'Usuario actualizado correctamente.');
    return res.redirect('/admin/users');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar usuario:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar el usuario.');
    return res.redirect(`/admin/users/${id}/edit`);
  }
});

module.exports = router;
