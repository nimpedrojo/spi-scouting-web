const express = require('express');

const authRoutes = require('../../routes/authRoutes');
const legalRoutes = require('../../routes/legalRoutes');
const userAdminRoutes = require('../../routes/userAdminRoutes');
const clubAdminRoutes = require('../../routes/clubAdminRoutes');
const clubConfigRoutes = require('../../routes/clubConfigRoutes');
const platformAdminRoutes = require('../../routes/platformAdminRoutes');
const teamRoutes = require('../../routes/teamRoutes');
const playerAdminRoutes = require('../../routes/playerAdminRoutes');
const playerProfileRoutes = require('../../routes/playerProfileRoutes');
const seasonRecommendationRoutes = require('../../routes/seasonRecommendationRoutes');

const router = express.Router();

router.use('/', legalRoutes);
router.use('/', authRoutes);
router.use('/admin/users', userAdminRoutes);
router.use('/admin/clubs', clubAdminRoutes);
router.use('/clubs', clubAdminRoutes);
router.use('/admin/club', clubConfigRoutes);
router.use('/admin/platform', platformAdminRoutes);
router.use('/teams', teamRoutes);
router.use('/admin/players', playerAdminRoutes);
router.use('/', seasonRecommendationRoutes);
router.use('/', playerProfileRoutes);

module.exports = router;
