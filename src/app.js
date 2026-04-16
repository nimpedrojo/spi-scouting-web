const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const dotenv = require('dotenv');
const expressLayouts = require('express-ejs-layouts');
const { initDatabaseOnce } = require('./initDb');
const { attachSessionContext } = require('./middleware/sessionContext');
const { attachProductModeContext } = require('./middleware/productModeContext');
const { attachModuleContext } = require('./middleware/moduleMiddleware');
const logger = require('./services/logger');
const { requestLogger } = require('./middleware/requestLogger');

dotenv.config();

initDatabaseOnce().catch((err) => {
  logger.error('Error initializing database', logger.formatError(err));
});

const app = express();
app.set('trust proxy', 1);
// Middlewares
app.use(requestLogger);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'session_secret_dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  }),
);
app.use(flash());
app.use(attachSessionContext);
app.use(attachProductModeContext);
app.use(attachModuleContext);

app.use((req, res, next) => {
  const productModeInfo = req.context ? req.context.productMode || null : null;
  const productMeta = productModeInfo && productModeInfo.effectiveMeta
    ? productModeInfo.effectiveMeta
    : null;

  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.activeRoute = req.path;
  res.locals.activeClubName = req.context && req.context.club ? req.context.club.name : null;
  res.locals.activeClubBranding = req.context && req.context.club
    ? {
      interfaceColor: req.context.club.interface_color || null,
      crestPath: req.context.club.crest_path || null,
    }
    : null;
  res.locals.activeSeasonLabel = req.context && req.context.activeSeason
    ? req.context.activeSeason.name
    : null;
  res.locals.activeModules = req.context ? req.context.activeModuleKeys || [] : [];
  res.locals.productModeInfo = productModeInfo;
  res.locals.productMode = productModeInfo
    ? productModeInfo.effectiveMode
    : 'suite';
  res.locals.isPmvPlayerTracking = Boolean(
    productModeInfo
    && productModeInfo.isPmvPlayerTracking,
  );
  res.locals.productBranding = {
    productLabel: productMeta ? productMeta.productLabel : 'SoccerProcessIQ Suite',
    productSubtitle: productMeta ? productMeta.productSubtitle : 'Modular Football Club Platform',
    productSignature: productMeta ? productMeta.productSignature : 'by ProcessIQ',
    productWordmark: productMeta ? productMeta.productWordmark : 'SoccerProcessIQ Suite',
    logoAsset: productMeta ? productMeta.logoAsset : '/img/soccerreport-logo.png',
    logoCompactAsset: productMeta ? productMeta.logoCompactAsset : '/img/soccerreport-logo.png',
    iconAsset: productMeta ? productMeta.iconAsset : '/img/soccerreport-logo.png',
    brandAccent: productMeta ? productMeta.brandAccent : 'suite',
  };
  res.locals.pageTitle = productMeta ? productMeta.productLabel : 'SoccerProcessIQ Suite';

  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Routes
const coreRoutes = require('./core/routes');
const scoutingPlayersRoutes = require('./modules/scoutingPlayers/routes');
const planningRoutes = require('./modules/planning/routes');
const scoutingTeamsRoutes = require('./modules/scoutingTeams/routes');

app.use('/', coreRoutes);
app.use('/', scoutingPlayersRoutes);
app.use('/planning', planningRoutes);
app.use('/scouting-teams', scoutingTeamsRoutes);

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

module.exports = app;
