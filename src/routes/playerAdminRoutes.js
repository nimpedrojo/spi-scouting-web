const express = require('express');
const {
  getAllPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
} = require('../models/playerModel');

const router = express.Router();

function ensureAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    return res.redirect('/');
  }
  return next();
}

// Listado de jugadores
router.get('/', ensureAdmin, async (req, res) => {
  try {
    const players = await getAllPlayers();
    return res.render('players/list', { players });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al obtener jugadores:', err);
    req.flash('error', 'Ha ocurrido un error al cargar los jugadores.');
    return res.redirect('/');
  }
});

// Formulario de edición de jugador
router.get('/:id/edit', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const player = await getPlayerById(id);
    if (!player) {
      req.flash('error', 'Jugador no encontrado.');
      return res.redirect('/admin/players');
    }
    return res.render('players/edit', { player });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al cargar jugador para edición:', err);
    req.flash('error', 'Ha ocurrido un error al cargar el jugador.');
    return res.redirect('/admin/players');
  }
});

router.post('/:id/edit', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    first_name,
    last_name,
    team,
    birth_date,
    birth_year,
    laterality,
  } = req.body;

  if (!first_name || !last_name) {
    req.flash('error', 'Nombre y apellidos son obligatorios.');
    return res.redirect(`/admin/players/${id}/edit`);
  }

  try {
    const affected = await updatePlayer(id, {
      firstName: first_name,
      lastName: last_name,
      team: team || null,
      birthDate: birth_date || null,
      birthYear: birth_year || null,
      laterality: laterality || null,
    });

    if (!affected) {
      req.flash('error', 'No se ha podido actualizar el jugador.');
      return res.redirect(`/admin/players/${id}/edit`);
    }

    req.flash('success', 'Jugador actualizado correctamente.');
    return res.redirect('/admin/players');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al actualizar jugador:', err);
    req.flash('error', 'Ha ocurrido un error al actualizar el jugador.');
    return res.redirect(`/admin/players/${id}/edit`);
  }
});

// Borrado individual de jugador
router.post('/:id/delete', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const affected = await deletePlayer(id);
    if (!affected) {
      req.flash('error', 'No se ha podido borrar el jugador.');
    } else {
      req.flash('success', 'Jugador borrado correctamente.');
    }
    return res.redirect('/admin/players');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error al borrar jugador:', err);
    req.flash('error', 'Ha ocurrido un error al borrar el jugador.');
    return res.redirect('/admin/players');
  }
});

// Borrado múltiple de jugadores
router.post('/bulk-delete', ensureAdmin, async (req, res) => {
  let { playerIds } = req.body;

  if (!playerIds) {
    req.flash('error', 'No has seleccionado ningún jugador para borrar.');
    return res.redirect('/admin/players');
  }

  if (!Array.isArray(playerIds)) {
    playerIds = [playerIds];
  }

  try {
    const idsToDelete = playerIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));

    // eslint-disable-next-line no-restricted-syntax
    for (const id of idsToDelete) {
      // eslint-disable-next-line no-await-in-loop
      await deletePlayer(id);
    }

    if (idsToDelete.length) {
      req.flash('success', 'Jugadores seleccionados borrados correctamente.');
    } else {
      req.flash('error', 'No se ha borrado ningún jugador.');
    }

    return res.redirect('/admin/players');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error en borrado múltiple de jugadores:', err);
    req.flash(
      'error',
      'Ha ocurrido un error al borrar los jugadores seleccionados.',
    );
    return res.redirect('/admin/players');
  }
});

module.exports = router;

