const {
  getTeamsGroupedBySectionAndCategory,
  getTeamDetail,
  getTeamFormData,
  createTeamForUser,
  updateTeamForUser,
  deleteTeamForUser,
  validateTeamPayload,
} = require('../services/teamService');
const { findTeamById } = require('../models/teamModel');

async function renderIndex(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    if (!club) {
      req.flash('error', 'Configura primero un club por defecto para usar Plantillas.');
      return res.redirect('/dashboard');
    }

    const activeSection = req.query.section || 'Masculina';
    const activeCategory = req.query.category || '';
    const activeSeason = req.context ? req.context.activeSeason : null;
    const groupedTeams = await getTeamsGroupedBySectionAndCategory(club.id, {
      section: activeSection,
      category: activeCategory || null,
    });

    return res.render('teams/index', {
      pageTitle: 'Plantillas',
      clubName: club.name,
      activeSeason,
      activeSection,
      activeCategory,
      groupedTeams,
      availableSections: ['Masculina', 'Femenina'],
      availableCategories: [
        'Juvenil',
        'Cadete',
        'Infantil',
        'Alevín',
        'Benjamín',
        'Prebenjamín',
        'Debutantes',
      ],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading teams index', err);
    req.flash('error', 'Ha ocurrido un error al cargar las plantillas.');
    return res.redirect('/dashboard');
  }
}

async function renderShow(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    const team = await getTeamDetail(req.params.id);
    const viewMode = req.query.view === 'cards' ? 'cards' : 'list';
    if (!club || !team || team.club_id !== club.id) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    return res.render('teams/show', {
      pageTitle: team.name,
      team,
      viewMode,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading team detail', err);
    req.flash('error', 'Ha ocurrido un error al cargar el equipo.');
    return res.redirect('/teams');
  }
}

async function renderNew(req, res) {
  try {
    const formData = await getTeamFormData(req.session.user);
    if (!formData) {
      req.flash('error', 'Configura primero un club por defecto para crear equipos.');
      return res.redirect('/dashboard');
    }

    return res.render('teams/form', {
      pageTitle: 'Nueva plantilla',
      team: null,
      formData,
      formAction: '/teams',
      submitLabel: 'Crear plantilla',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading new team form', err);
    req.flash('error', 'Ha ocurrido un error al cargar el formulario.');
    return res.redirect('/teams');
  }
}

async function create(req, res) {
  try {
    const payload = {
      name: req.body.name,
      seasonId: req.body.season_id,
      sectionId: req.body.section_id,
      categoryId: req.body.category_id,
    };
    const validationError = await validateTeamPayload(req.session.user, payload);
    if (validationError) {
      req.flash('error', validationError);
      return res.redirect('/teams/new');
    }

    const team = await createTeamForUser(req.session.user, payload);
    req.flash('success', 'Plantilla creada correctamente.');
    return res.redirect(`/teams/${team.id}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error creating team', err);
    req.flash('error', 'Ha ocurrido un error al crear la plantilla.');
    return res.redirect('/teams/new');
  }
}

async function renderEdit(req, res) {
  try {
    const [formData, team] = await Promise.all([
      getTeamFormData(req.session.user),
      findTeamById(req.params.id),
    ]);
    if (!formData || !team || team.club_id !== formData.club.id) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    return res.render('teams/form', {
      pageTitle: `Editar ${team.name}`,
      team,
      formData,
      formAction: `/teams/${team.id}/update`,
      submitLabel: 'Guardar cambios',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading team edit', err);
    req.flash('error', 'Ha ocurrido un error al cargar la plantilla.');
    return res.redirect('/teams');
  }
}

async function update(req, res) {
  try {
    const payload = {
      name: req.body.name,
      seasonId: req.body.season_id,
      sectionId: req.body.section_id,
      categoryId: req.body.category_id,
    };
    const validationError = await validateTeamPayload(req.session.user, payload);
    if (validationError) {
      req.flash('error', validationError);
      return res.redirect(`/teams/${req.params.id}/edit`);
    }

    const affected = await updateTeamForUser(req.session.user, req.params.id, payload);
    if (!affected) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }

    req.flash('success', 'Plantilla actualizada correctamente.');
    return res.redirect(`/teams/${req.params.id}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error updating team', err);
    req.flash('error', 'Ha ocurrido un error al actualizar la plantilla.');
    return res.redirect(`/teams/${req.params.id}/edit`);
  }
}

async function remove(req, res) {
  try {
    const affected = await deleteTeamForUser(req.session.user, req.params.id);
    if (!affected) {
      req.flash('error', 'Equipo no encontrado.');
      return res.redirect('/teams');
    }
    req.flash('success', 'Plantilla eliminada correctamente.');
    return res.redirect('/teams');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error deleting team', err);
    req.flash('error', 'Ha ocurrido un error al eliminar la plantilla.');
    return res.redirect('/teams');
  }
}

module.exports = {
  renderIndex,
  renderShow,
  renderNew,
  create,
  renderEdit,
  update,
  remove,
};
