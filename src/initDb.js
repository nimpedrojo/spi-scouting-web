const { createUsersTable, ensureAdminUser } = require('./models/userModel');
const { createReportsTable } = require('./models/reportModel');
const { createPlayersTable } = require('./models/playerModel');
const { createClubsTable } = require('./models/clubModel');
const { createClubTeamsTable } = require('./models/clubTeamModel');
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

let initializationPromise = null;

async function initializeDatabase() {
  await createUsersTable();
  await createClubsTable();
  await createClubTeamsTable();
  await createClubRecommendationsTable();
  await createReportsTable();
  await createSeasonsTable();
  await createSectionsTable();
  await createCategoriesTable();
  await createTeamsTable();
  await createPlayersTable();
  await createTeamPlayersTable();
  await createEvaluationsTable();
  await createEvaluationScoresTable();
  await createEvaluationTemplatesTable();
  await createEvaluationTemplateMetricsTable();
  await seedDefaultSections();
  await seedDefaultCategories();
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
