jest.mock('../src/app', () => ({ listen: jest.fn() }));
jest.mock('../src/initDb', () => ({ initDatabaseOnce: jest.fn() }));
jest.mock('../src/services/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  formatError: jest.fn((error) => ({ message: error.message })),
}));

describe('Server listener configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.HOST;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test.each([undefined, '0.0.0.0'])('binds to configured HOST or loopback by default (%s)', async (host) => {
    if (host !== undefined) process.env.HOST = host;
    process.env.PORT = '3002';
    const app = require('../src/app');
    const { initDatabaseOnce } = require('../src/initDb');
    let finishInitialization;
    initDatabaseOnce.mockReturnValue(new Promise((resolve) => { finishInitialization = resolve; }));

    require('../src/server');
    expect(app.listen).not.toHaveBeenCalled();
    finishInitialization();
    await new Promise(setImmediate);

    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith('3002', host || '127.0.0.1', expect.any(Function));
  });

  test('preserves the default port', async () => {
    const app = require('../src/app');
    require('../src/initDb').initDatabaseOnce.mockResolvedValue();
    require('../src/server');
    await new Promise(setImmediate);

    expect(app.listen).toHaveBeenCalledWith(3000, '127.0.0.1', expect.any(Function));
  });

  test('does not listen when database initialization fails', async () => {
    const app = require('../src/app');
    const logger = require('../src/services/logger');
    require('../src/initDb').initDatabaseOnce.mockRejectedValue(new Error('Initialization failed'));
    require('../src/server');
    await new Promise(setImmediate);

    expect(app.listen).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Error initializing database tables', { message: 'Initialization failed' },
    );
  });
});
