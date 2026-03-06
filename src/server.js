const app = require('./app');
const { initDatabaseOnce } = require('./initDb');

const PORT = process.env.PORT || 3000;

initDatabaseOnce()
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
