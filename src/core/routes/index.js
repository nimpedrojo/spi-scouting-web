const express = require('express');

const authRoutes = require('../../routes/authRoutes');
const userAdminRoutes = require('../../routes/userAdminRoutes');
const clubAdminRoutes = require('../../routes/clubAdminRoutes');
const clubConfigRoutes = require('../../routes/clubConfigRoutes');
const teamRoutes = require('../../routes/teamRoutes');
const playerAdminRoutes = require('../../routes/playerAdminRoutes');

const router = express.Router();

router.use('/', authRoutes);
router.use('/admin/users', userAdminRoutes);
router.use('/admin/clubs', clubAdminRoutes);
router.use('/clubs', clubAdminRoutes);
router.use('/admin/club', clubConfigRoutes);
router.use('/teams', teamRoutes);
router.use('/admin/players', playerAdminRoutes);

module.exports = router;
