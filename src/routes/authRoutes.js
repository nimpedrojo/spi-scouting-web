const express = require('express');
const bcrypt = require('bcryptjs');
const {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserAccount,
} = require('../models/userModel');
const { getPlayersByTeam } = require('../models/playerModel');

const router = express.Router();

function ensureGuest(req, res, next) {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  return next();
}

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Debes iniciar sesión.');
    return res.redirect('/login');
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
      req.flash('error', 'Usuario o contraseña incorrectos.');
      return res.redirect('/login');
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      req.flash('error', 'Usuario o contraseña incorrectos.');
      return res.redirect('/login');
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      default_club: user.default_club,
      default_team: user.default_team,
    };
    req.flash('success', 'Has iniciado sesión correctamente.');
    return res.redirect('/dashboard');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    req.flash('error', 'Ha ocurrido un error al iniciar sesión.');
    return res.redirect('/login');
  }
});

router.get('/register', ensureGuest, (req, res) => {
  res.render('auth/register');
});

router.post('/register', ensureGuest, async (req, res) => {
  const { name, email, password, password2 } = req.body;
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
    await createUser({ name, email, password });
    req.flash('success', 'Usuario creado. Ahora puedes iniciar sesión.');
    return res.redirect('/login');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    req.flash('error', 'Ha ocurrido un error al registrar usuario.');
    return res.redirect('/register');
  }
});

router.post('/logout', ensureAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Página de cuenta del usuario
router.get('/account', ensureAuth, async (req, res) => {
  try {
    const user = await findUserById(req.session.user.id);
    const teams = await getPlayersByTeam(null);
    const uniqueTeams = Array.from(
      new Set(teams.map((p) => p.team).filter((t) => t && t.trim())),
    ).sort();

    return res.render('auth/account', {
      user,
      teams: uniqueTeams,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar cuenta:', err);
    req.flash('error', 'Ha ocurrido un error al cargar tu cuenta.');
    return res.redirect('/reports/new');
  }
});

router.post('/account', ensureAuth, async (req, res) => {
  const { name, email, default_club, default_team } = req.body;

  if (!name || !email) {
    req.flash('error', 'Nombre y email son obligatorios.');
    return res.redirect('/account');
  }

  try {
    const affected = await updateUserAccount(req.session.user.id, {
      name,
      email,
      defaultClub: default_club || null,
      defaultTeam: default_team || null,
    });
    if (!affected) {
      req.flash('error', 'No se ha podido actualizar tu cuenta.');
      return res.redirect('/account');
    }

    // Actualizar los datos en sesión
    req.session.user.name = name;
    req.session.user.email = email;
    req.session.user.default_club = default_club || null;
    req.session.user.default_team = default_team || null;

    req.flash('success', 'Tu cuenta se ha actualizado correctamente.');
    return res.redirect('/account');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar cuenta:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar tu cuenta.');
    return res.redirect('/account');
  }
});

// Dashboard principal (menú de cards)
router.get('/dashboard', ensureAuth, (req, res) => {
  res.render('dashboard');
});

module.exports = router;
