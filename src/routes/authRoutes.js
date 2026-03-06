const express = require('express');
const bcrypt = require('bcryptjs');
const {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserAccount,
} = require('../models/userModel');
const { getClubByCode } = require('../models/clubModel');
const { getPlayersByTeam } = require('../models/playerModel');
const { getTeamsByClub } = require('../models/clubTeamModel');
const { ensureAuth } = require('../middleware/auth');

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
    });

    // Actualizar el default_club del usuario recién creado
    const createdUser = await findUserByEmail(email);
    if (createdUser) {
      await updateUserAccount(createdUser.id, {
        name: createdUser.name,
        email: createdUser.email,
        defaultClub: club.name,
        defaultTeam: createdUser.default_team || null,
      });
    }
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
    const clubFilter = user.default_club || null;

    let uniqueTeams = [];
    if (clubFilter) {
      const clubTeams = await getTeamsByClub(clubFilter);
      uniqueTeams = clubTeams.map((t) => t.name);
    } else {
      const players = await getPlayersByTeam(null, null);
      uniqueTeams = Array.from(
        new Set(players.map((p) => p.team).filter((t) => t && t.trim())),
      ).sort();
    }

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
    let defaultClubValue = default_club && default_club.trim()
      ? default_club.trim()
      : null;
    let defaultTeamValue = default_team && default_team.trim()
      ? default_team.trim()
      : null;

    if (defaultClubValue) {
      const clubTeams = await getTeamsByClub(defaultClubValue);
      const allowedTeams = clubTeams.map((t) => t.name);
      if (defaultTeamValue && !allowedTeams.includes(defaultTeamValue)) {
        req.flash(
          'error',
          'El equipo por defecto debe ser uno de los equipos configurados para el club.',
        );
        return res.redirect('/account');
      }
      if (!defaultTeamValue) {
        defaultTeamValue = null;
      }
    } else if (!defaultTeamValue) {
      // Sin club todavía: usar marcador "-" hasta que se escoja
      defaultTeamValue = '-';
    }

    const affected = await updateUserAccount(req.session.user.id, {
      name,
      email,
      defaultClub: defaultClubValue,
      defaultTeam: defaultTeamValue,
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
