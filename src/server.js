const app = require('./app');
const { initDatabaseOnce } = require('./initDb');
const logger = require('./services/logger');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

initDatabaseOnce()
  .then(() => {
    app.listen(PORT, HOST, () => {
      logger.info('Server listening', {
        port: Number(PORT),
        env: process.env.NODE_ENV || 'development',
      });
    });
  })
  .catch((err) => {
    logger.error('Error initializing database tables', logger.formatError(err));
  });
