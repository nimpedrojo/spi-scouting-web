const express = require('express');
const bcrypt = require('bcryptjs');
const {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserAccount,
} = require('../models/userModel');
const { getClubByCode, getClubByName } = require('../models/clubModel');
const { ensureAuth } = require('../middleware/auth');
const { renderDashboard } = require('../controllers/dashboardController');
const { findTeamById } = require('../models/teamModel');
const { getDefaultTeamOptionsForClub } = require('../services/teamService');
const logger = require('../services/logger');

const router = express.Router();

function ensureGuest(req, res, next) {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  return next();
}

router.get('/login', ensureGuest, (req, res) => {
  res.render('auth/login');
});

router.post('/login', ensureGuest, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await findUserByEmail(email);
    if (!user) {
      logger.warn('Login failed: user not found', {
        type: 'auth',
        action: 'login_failed',
        email,
        ip: req.ip,
      });
      req.flash('error', 'Usuario o contraseña incorrectos.');
      return res.redirect('/login');
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      logger.warn('Login failed: invalid password', {
        type: 'auth',
        action: 'login_failed',
        email,
        userId: user.id,
        ip: req.ip,
      });
      req.flash('error', 'Usuario o contraseña incorrectos.');
      return res.redirect('/login');
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      club_id: user.club_id || null,
      default_club: user.default_club,
      default_team: user.default_team_name || user.default_team,
      default_team_id: user.default_team_id || null,
      processiq_username: user.processiq_username || null,
    };
    logger.info('Login successful', {
      type: 'auth',
      action: 'login_success',
      userId: user.id,
      email: user.email,
      role: user.role,
      clubId: user.club_id || null,
      ip: req.ip,
    });
    req.flash('success', 'Has iniciado sesión correctamente.');
    return res.redirect('/dashboard');
  } catch (err) {
    logger.error('Login error', {
      type: 'auth',
      action: 'login_error',
      email,
      ip: req.ip,
      error: logger.formatError(err),
    });
    req.flash('error', 'Ha ocurrido un error al iniciar sesión.');
    return res.redirect('/login');
  }
});

router.get('/register', ensureGuest, (req, res) => {
  res.render('auth/register');
});

router.post('/register', ensureGuest, async (req, res) => {
  const {
    name,
    email,
    password,
    password2,
    club_code,
  } = req.body;
  if (!name || !email || !password) {
    req.flash('error', 'Todos los campos son obligatorios.');
    return res.redirect('/register');
  }
  if (password !== password2) {
    req.flash('error', 'Las contraseñas no coinciden.');
    return res.redirect('/register');
  }

  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    req.flash('error', 'El email no tiene un formato válido.');
    return res.redirect('/register');
  }

  if (password.length < 8) {
    req.flash('error', 'La contraseña debe tener al menos 8 caracteres.');
    return res.redirect('/register');
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      req.flash('error', 'Ya existe un usuario con ese email.');
      return res.redirect('/register');
    }

    if (!club_code || !club_code.trim()) {
      req.flash(
        'error',
        'Es obligatorio indicar un código de club válido para registrarse.',
      );
      return res.redirect('/register');
    }

    const club = await getClubByCode(club_code.trim());
    if (!club) {
      req.flash(
        'error',
        'El código de club no es válido. Contacta con tu responsable para que te facilite un código correcto.',
      );
      return res.redirect('/register');
    }

    await createUser({
      name,
      email,
      password,
      clubId: club.id,
      defaultClub: club.name,
    });

    logger.info('User registered', {
      type: 'auth',
      action: 'register_success',
      email,
      clubId: club.id,
      ip: req.ip,
    });

    req.flash('success', 'Usuario creado. Ahora puedes iniciar sesión.');
    return res.redirect('/login');
  } catch (err) {
    logger.error('Register error', {
      type: 'auth',
      action: 'register_error',
      email,
      ip: req.ip,
      error: logger.formatError(err),
    });
    req.flash('error', 'Ha ocurrido un error al registrar usuario.');
    return res.redirect('/register');
  }
});

router.post('/logout', ensureAuth, (req, res) => {
  const user = req.session.user;
  logger.info('Logout successful', {
    type: 'auth',
    action: 'logout',
    userId: user ? user.id : null,
    email: user ? user.email : null,
    ip: req.ip,
  });
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Página de cuenta del usuario
router.get('/account', ensureAuth, async (req, res) => {
  try {
    const user = await findUserById(req.session.user.id);
    const resolvedClub = user.club_id
      ? { id: user.club_id, name: user.club_name || user.default_club }
      : (user.default_club ? await getClubByName(user.default_club) : null);
    const teamOptions = resolvedClub
      ? await getDefaultTeamOptionsForClub(resolvedClub.id)
      : [];

    return res.render('auth/account', {
      user,
      teams: teamOptions,
      resolvedClub,
    });
  } catch (err) {
    logger.error('Error loading account page', {
      type: 'account',
      action: 'account_view_error',
      userId: req.session.user ? req.session.user.id : null,
      error: logger.formatError(err),
    });
    req.flash('error', 'Ha ocurrido un error al cargar tu cuenta.');
    return res.redirect('/reports/new');
  }
});

router.post('/account', ensureAuth, async (req, res) => {
  const {
    name,
    email,
    default_club,
    default_team_id,
    processiq_username,
    processiq_password,
  } = req.body;

  if (!name || !email) {
    req.flash('error', 'Nombre y email son obligatorios.');
    return res.redirect('/account');
  }

  try {
    const currentUser = await findUserById(req.session.user.id);
    let defaultClubValue = default_club && default_club.trim()
      ? default_club.trim()
      : null;
    let defaultTeamIdValue = default_team_id && default_team_id.trim()
      ? default_team_id.trim()
      : null;
    let defaultTeamValue = null;
    const processIqUsernameValue = processiq_username && processiq_username.trim()
      ? processiq_username.trim()
      : null;
    const processIqPasswordValue = processiq_password && processiq_password.trim()
      ? processiq_password.trim()
      : (currentUser.processiq_password || null);

    const resolvedClub = currentUser && currentUser.club_id
      ? { id: currentUser.club_id, name: currentUser.club_name || currentUser.default_club }
      : (defaultClubValue ? await getClubByName(defaultClubValue) : null);

    if (currentUser && currentUser.club_id && currentUser.club_name) {
      defaultClubValue = currentUser.club_name;
    }

    if (defaultTeamIdValue) {
      const selectedTeam = await findTeamById(defaultTeamIdValue);
      if (!selectedTeam || !resolvedClub || selectedTeam.club_id !== resolvedClub.id) {
        req.flash(
          'error',
          'El equipo por defecto debe ser uno de los equipos v2 configurados para el club.',
        );
        return res.redirect('/account');
      }
      defaultTeamIdValue = selectedTeam.id;
      defaultTeamValue = selectedTeam.name;
    }

    const affected = await updateUserAccount(req.session.user.id, {
      name,
      email,
      defaultClub: defaultClubValue,
      defaultTeam: defaultTeamValue,
      defaultTeamId: defaultTeamIdValue,
      processIqUsername: processIqUsernameValue,
      processIqPassword: processIqPasswordValue,
    });
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar tu cuenta.');
      return res.redirect('/account');
    }

    // Actualizar los datos en sesión
    req.session.user.name = name;
    req.session.user.email = email;
    req.session.user.default_club = defaultClubValue;
    req.session.user.default_team = defaultTeamValue;
    req.session.user.default_team_id = defaultTeamIdValue;
    req.session.user.processiq_username = processIqUsernameValue;

    logger.info('Account updated', {
      type: 'account',
      action: 'account_update',
      userId: req.session.user.id,
      email,
      defaultClub: defaultClubValue,
      defaultTeamId: defaultTeamIdValue,
      processIqUsername: processIqUsernameValue,
      ip: req.ip,
    });

    req.flash('success', 'Tu cuenta se ha actualizado correctamente.');
    return res.redirect('/account');
  } catch (err) {
    logger.error('Error updating account', {
      type: 'account',
      action: 'account_update_error',
      userId: req.session.user ? req.session.user.id : null,
      email,
      error: logger.formatError(err),
    });
    req.flash('error', 'Ha ocurrido un error al actualizar tu cuenta.');
    return res.redirect('/account');
  }
});

router.get('/dashboard', ensureAuth, renderDashboard);

module.exports = router;
