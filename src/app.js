const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const dotenv = require('dotenv');
const expressLayouts = require('express-ejs-layouts');
const { initDatabaseOnce } = require('./initDb');
const { attachSessionContext } = require('./middleware/sessionContext');
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

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.activeRoute = req.path;
  res.locals.activeClubName = req.context && req.context.club ? req.context.club.name : null;
  res.locals.activeSeasonLabel = req.context && req.context.activeSeason
    ? req.context.activeSeason.name
    : null;
  res.locals.pageTitle = 'SoccerReport';

  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/authRoutes');
const reportRoutes = require('./routes/reportRoutes');
const userAdminRoutes = require('./routes/userAdminRoutes');
const playerAdminRoutes = require('./routes/playerAdminRoutes');
const clubAdminRoutes = require('./routes/clubAdminRoutes');
const clubConfigRoutes = require('./routes/clubConfigRoutes');
const teamRoutes = require('./routes/teamRoutes');
const evaluationRoutes = require('./routes/evaluationRoutes');
const playerProfileRoutes = require('./routes/playerProfileRoutes');
const evaluationTemplateRoutes = require('./routes/evaluationTemplateRoutes');
const seasonComparisonRoutes = require('./routes/seasonComparisonRoutes');
const seasonForecastRoutes = require('./routes/seasonForecastRoutes');
const assessmentRoutes = require('./routes/assessmentRoutes');

app.use('/', authRoutes);
app.use('/reports', reportRoutes);
app.use('/admin/users', userAdminRoutes);
app.use('/admin/players', playerAdminRoutes);
app.use('/admin/clubs', clubAdminRoutes);
app.use('/clubs', clubAdminRoutes);
app.use('/admin/club', clubConfigRoutes);
app.use('/teams', teamRoutes);
app.use('/', assessmentRoutes);
app.use('/', evaluationRoutes);
app.use('/', playerProfileRoutes);
app.use('/', evaluationTemplateRoutes);
app.use('/', seasonComparisonRoutes);
app.use('/', seasonForecastRoutes);

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

module.exports = app;
