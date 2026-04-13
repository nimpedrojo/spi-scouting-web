const express = require('express');
const { ensureAuth } = require('../../../middleware/auth');
const { requireModule } = require('../../../middleware/moduleMiddleware');
const { MODULE_KEYS } = require('../../../shared/constants/moduleKeys');
const controller = require('../controllers/scoutingTeamsController');
const { findScoutingTeamReportById } = require('../services/scoutingTeamsService');
const { getScoutingTeamsPermissions } = require('../services/scoutingTeamsPermissionService');

const router = express.Router();

function requireScoutingTeamsCreateAccess(req, res, next) {
  const permissions = getScoutingTeamsPermissions(req.session.user);

  if (!permissions.canCreate) {
    req.flash('error', 'No tienes permisos para crear informes de scouting de equipos.');
    return res.redirect('/scouting-teams');
  }

  req.scoutingTeamsPermissions = permissions;
  return next();
}

async function loadScopedReport(req, res, next) {
  const club = req.context ? req.context.club : null;
  const report = await findScoutingTeamReportById(club.id, req.params.id);

  if (!report) {
    req.flash('error', 'Informe de scouting de equipos no encontrado.');
    return res.redirect('/scouting-teams');
  }

  req.scoutingTeamsReport = report;
  req.scoutingTeamsPermissions = getScoutingTeamsPermissions(req.session.user, report);
  return next();
}

function requireScoutingTeamsEditAccess(req, res, next) {
  if (!req.scoutingTeamsPermissions || !req.scoutingTeamsPermissions.canEdit) {
    req.flash('error', 'No tienes permisos para editar este informe de scouting.');
    return res.redirect(`/scouting-teams/${req.params.id}`);
  }

  return next();
}

function requireScoutingTeamsDeleteAccess(req, res, next) {
  if (!req.scoutingTeamsPermissions || !req.scoutingTeamsPermissions.canDelete) {
    req.flash('error', 'Solo administradores del club pueden borrar informes de scouting.');
    return res.redirect(`/scouting-teams/${req.params.id}`);
  }

  return next();
}

router.use(ensureAuth, requireModule(MODULE_KEYS.SCOUTING_TEAMS));

router.get('/', controller.renderIndex);
router.get('/new', requireScoutingTeamsCreateAccess, controller.renderNew);
router.post('/', requireScoutingTeamsCreateAccess, controller.create);
router.get('/:id', loadScopedReport, controller.renderShow);
router.get('/:id/edit', loadScopedReport, requireScoutingTeamsEditAccess, controller.renderEdit);
router.post('/:id/update', loadScopedReport, requireScoutingTeamsEditAccess, controller.update);
router.post('/:id/delete', loadScopedReport, requireScoutingTeamsDeleteAccess, controller.remove);

module.exports = router;
