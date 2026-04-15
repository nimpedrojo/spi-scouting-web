const { createUsersTable, ensureAdminUser, syncUserClubAssignments } = require('./models/userModel');
const { createReportsTable } = require('./models/reportModel');
const { createPlayersTable } = require('./models/playerModel');
const { createClubsTable } = require('./models/clubModel');
const { createClubRecommendationsTable } = require('./models/clubRecommendationModel');
const { createSeasonsTable } = require('./models/seasonModel');
const { createSectionsTable, seedDefaultSections } = require('./models/sectionModel');
const { createCategoriesTable, seedDefaultCategories } = require('./models/categoryModel');
const { createTeamsTable } = require('./models/teamModel');
const { createTeamPlayersTable } = require('./models/teamPlayerModel');
const { createEvaluationsTable } = require('./models/evaluationModel');
const { createEvaluationScoresTable } = require('./models/evaluationScoreModel');
const { createEvaluationTemplatesTable } = require('./models/evaluationTemplateModel');
const { createEvaluationTemplateMetricsTable } = require('./models/evaluationTemplateMetricModel');
const {
  createClubModulesTable,
  seedDefaultClubModules,
} = require('./core/models/clubModuleModel');
const {
  createPlatformSettingsTable,
  ensurePlatformSettingsRow,
} = require('./core/models/platformSettingsModel');
const {
  createScoutingTeamOpponentsTable,
} = require('./modules/scoutingTeams/models/scoutingTeamOpponentModel');
const {
  createScoutingTeamReportsTable,
} = require('./modules/scoutingTeams/models/scoutingTeamReportModel');
const {
  createSeasonPlansTable,
} = require('./modules/planning/models/seasonPlanModel');
const {
  createPlanMicrocyclesTable,
} = require('./modules/planning/models/planMicrocycleModel');
const {
  createPlanSessionsTable,
} = require('./modules/planning/models/planSessionModel');
const {
  createPlanSessionTasksTable,
} = require('./modules/planning/models/planSessionTaskModel');
const {
  createPlanningMicrocycleTemplatesTable,
} = require('./modules/planning/models/planningMicrocycleTemplateModel');
const { ensureDatabaseExists } = require('./db');

let initializationPromise = null;

async function initializeDatabase() {
  await ensureDatabaseExists();
  await createClubsTable();
  await createClubRecommendationsTable();
  await createSeasonsTable();
  await createSectionsTable();
  await createCategoriesTable();
  await createTeamsTable();
  await createUsersTable();
  await createClubModulesTable();
  await createPlatformSettingsTable();
  await createSeasonPlansTable();
  await createPlanMicrocyclesTable();
  await createPlanSessionsTable();
  await createPlanSessionTasksTable();
  await createPlanningMicrocycleTemplatesTable();
  await createScoutingTeamOpponentsTable();
  await createScoutingTeamReportsTable();
  await createReportsTable();
  await createPlayersTable();
  await createTeamPlayersTable();
  await createEvaluationsTable();
  await createEvaluationScoresTable();
  await createEvaluationTemplatesTable();
  await createEvaluationTemplateMetricsTable();
  await seedDefaultSections();
  await seedDefaultCategories();
  await syncUserClubAssignments();
  await seedDefaultClubModules();
  await ensurePlatformSettingsRow();
  await ensureAdminUser();
}

function initDatabaseOnce() {
  if (!initializationPromise) {
    initializationPromise = initializeDatabase();
  }
  return initializationPromise;
}

module.exports = {
  initializeDatabase,
  initDatabaseOnce,
};
