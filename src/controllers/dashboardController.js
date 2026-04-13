const { getDashboardData } = require('../services/dashboardService');
const { MODULE_KEYS } = require('../shared/constants/moduleKeys');

function isAdminUser(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'superadmin'));
}

function isSuperAdminUser(user) {
  return Boolean(user && user.role === 'superadmin');
}

function buildCoreEntries(user, dashboard) {
  const entries = [
    {
      title: 'Equipos',
      description: 'Estructura deportiva, plantillas y acceso a equipos del club.',
      href: '/teams',
      meta: dashboard && dashboard.metrics
        ? `${dashboard.metrics.activeTeams} equipos activos`
        : 'Gestión base del club',
    },
    {
      title: 'Jugadores',
      description: 'Perfiles, altas y seguimiento de plantilla en el entorno común.',
      href: '/admin/players',
      meta: dashboard && dashboard.metrics
        ? `${dashboard.metrics.totalActivePlayers} jugadores activos`
        : 'Acceso a plantilla',
    },
  ];

  if (isAdminUser(user)) {
    entries.push(
      {
        title: 'Usuarios',
        description: 'Accesos, roles y organización del trabajo interno.',
        href: '/admin/users',
        meta: 'Permisos y cuentas',
      },
      {
        title: 'Configuración del club',
        description: 'Branding, módulos activos y ajustes operativos del club.',
        href: '/admin/club',
        meta: 'Configuración central',
      },
    );
  }

  if (isSuperAdminUser(user)) {
    entries.push({
      title: 'Clubes',
      description: 'Administración global de clubes dentro de la suite.',
      href: '/clubs',
      meta: 'Vista superadmin',
    });
  }

  return entries;
}

function buildModuleEntries(activeModuleKeys, dashboard, activeSeason) {
  const pendingTeams = dashboard && Array.isArray(dashboard.pendingByTeam)
    ? dashboard.pendingByTeam.filter((team) => team.pendingPlayers > 0).length
    : 0;
  const entries = [];

  if (activeModuleKeys.includes(MODULE_KEYS.SCOUTING_PLAYERS)) {
    entries.push({
      key: MODULE_KEYS.SCOUTING_PLAYERS,
      title: 'SPI Scouting Players',
      strapline: 'Seguimiento individual y evaluación de talento',
      description: 'Informes, valoraciones y lectura operativa de jugadores dentro de la temporada activa.',
      meta: [
        activeSeason ? `Temporada ${activeSeason.name}` : 'Sin temporada activa',
        dashboard && dashboard.metrics
          ? `${dashboard.metrics.reportsInActiveSeason} informes en temporada`
          : null,
        pendingTeams > 0 ? `${pendingTeams} equipos con pendientes` : 'Sin pendientes detectados',
      ].filter(Boolean),
      actions: [
        { label: 'Nuevo informe', href: '/reports/new', variant: 'primary' },
        { label: 'Ver informes', href: '/reports', variant: 'outline-secondary' },
        { label: 'Valoraciones', href: '/assessments', variant: 'outline-secondary' },
      ],
    });
  }

  if (activeModuleKeys.includes(MODULE_KEYS.PLANNING)) {
    entries.push({
      key: MODULE_KEYS.PLANNING,
      title: 'SPI Planning',
      strapline: 'Base de planificación deportiva del club',
      description: 'El módulo está disponible a nivel técnico y hoy expone su punto de entrada principal sin rutas adicionales de microciclos o sesiones.',
      meta: [
        activeSeason ? `Temporada ${activeSeason.name}` : 'Sin temporada activa',
        'Home del módulo disponible',
      ],
      actions: [
        { label: 'Abrir módulo', href: '/planning', variant: 'primary' },
      ],
    });
  }

  if (activeModuleKeys.includes(MODULE_KEYS.SCOUTING_TEAMS)) {
    entries.push({
      key: MODULE_KEYS.SCOUTING_TEAMS,
      title: 'SPI Scouting Teams',
      strapline: 'Scouting de rivales y análisis colectivo',
      description: 'Gestión de informes rivales y consulta del histórico ya registrado por el club.',
      meta: [
        dashboard && dashboard.modules
          ? `${dashboard.modules.scoutingTeamsReportCount} informes registrados`
          : 'Sin informes registrados',
      ],
      actions: [
        { label: 'Nuevo informe rival', href: '/scouting-teams/new', variant: 'primary' },
        { label: 'Informes de rivales', href: '/scouting-teams', variant: 'outline-secondary' },
      ],
    });
  }

  return entries;
}

async function renderDashboard(req, res) {
  try {
    const club = req.context ? req.context.club : null;
    const activeModuleKeys = req.context ? req.context.activeModuleKeys || [] : [];
    const currentUser = req.session ? req.session.user : null;
    if (!club) {
      return res.render('dashboard/index', {
        pageTitle: 'Panel general',
        dashboard: null,
        activeSeason: null,
        activeModuleKeys,
        coreEntries: buildCoreEntries(currentUser, null),
        moduleEntries: buildModuleEntries(activeModuleKeys, null, null),
      });
    }

    const activeSeason = req.context ? req.context.activeSeason : null;
    const dashboard = await getDashboardData(club.id, activeSeason, { activeModuleKeys });

    return res.render('dashboard/index', {
      pageTitle: 'Panel general',
      dashboard,
      activeSeason,
      activeModuleKeys,
      coreEntries: buildCoreEntries(currentUser, dashboard),
      moduleEntries: buildModuleEntries(activeModuleKeys, dashboard, activeSeason),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error loading dashboard', err);
    req.flash('error', 'Ha ocurrido un error al cargar el panel general.');
    return res.redirect('/');
  }
}

module.exports = {
  renderDashboard,
};
