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
