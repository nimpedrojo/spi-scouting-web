const app = require('./app');
const { createUsersTable, ensureAdminUser } = require('./models/userModel');
const { createReportsTable } = require('./models/reportModel');
const { createPlayersTable } = require('./models/playerModel');

const PORT = process.env.PORT || 3000;

async function init() {
  await createUsersTable();
  await createReportsTable();
  await createPlayersTable();
  await ensureAdminUser();
}

init()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Servidor escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Error initializing database tables', err);
  });
