const express = require('express');
const path = require('path');
const morgan = require('morgan');
const session = require('express-session');
const flash = require('connect-flash');
const dotenv = require('dotenv');
const expressLayouts = require('express-ejs-layouts');
const { initDatabaseOnce } = require('./initDb');
const { requireClubForUser, getActiveSeasonByClub } = require('./services/teamService');

dotenv.config();

initDatabaseOnce().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Error initializing database', err);
});

const app = express();
app.set('trust proxy', 1);
// Middlewares
app.use(morgan('dev'));
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

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.activeRoute = req.path;
  res.locals.activeClubName = req.session.user ? req.session.user.default_club : null;
  res.locals.activeSeasonLabel = null;
  res.locals.pageTitle = 'SoccerReport';

  if (req.session.user && req.session.user.default_club) {
    try {
      const club = await requireClubForUser(req.session.user);
      if (club) {
        const season = await getActiveSeasonByClub(club.id);
        res.locals.activeSeasonLabel = season ? season.name : null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error resolving active season for layout', err);
    }
  }

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

app.use('/', authRoutes);
app.use('/reports', reportRoutes);
app.use('/admin/users', userAdminRoutes);
app.use('/admin/players', playerAdminRoutes);
app.use('/admin/clubs', clubAdminRoutes);
app.use('/admin/club', clubConfigRoutes);
app.use('/teams', teamRoutes);
app.use('/', evaluationRoutes);
app.use('/', playerProfileRoutes);
app.use('/', evaluationTemplateRoutes);

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

module.exports = app;
