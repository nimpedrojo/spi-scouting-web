describe('Production PM2 release selection', () => {
  const previousRelease = process.env.SPI_RELEASE_PATH;

  afterEach(() => {
    if (previousRelease === undefined) delete process.env.SPI_RELEASE_PATH;
    else process.env.SPI_RELEASE_PATH = previousRelease;
    jest.resetModules();
  });

  test.each([
    undefined,
    'releases/4c1e3811030644cdcb25cc7bcb76d0d727158506',
    '/var/www/spi-scouting-deploy/current',
    '/var/www/spi-scouting-deploy/releases/rehearsal-5MGigLAe',
    '/var/www/spi-playertrack/4c1e3811030644cdcb25cc7bcb76d0d727158506',
    '/var/www/spi-scouting-deploy/releases/../shared',
  ])('rejects an unsafe or missing release selection (%s)', (release) => {
    if (release === undefined) delete process.env.SPI_RELEASE_PATH;
    else process.env.SPI_RELEASE_PATH = release;
    expect(() => require('../ecosystem.config.cjs')).toThrow('SPI_RELEASE_PATH');
  });

  test('declares only the inventoried application with explicit release paths', () => {
    const release = '/var/www/spi-scouting-deploy/releases/4c1e3811030644cdcb25cc7bcb76d0d727158506';
    process.env.SPI_RELEASE_PATH = release;
    const { apps } = require('../ecosystem.config.cjs');
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      name: 'soccer-report',
      cwd: release,
      script: `${release}/src/server.js`,
      interpreter: '/usr/bin/node',
      exec_mode: 'fork', instances: 1, watch: false,
      env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3002' },
    });
    expect(Object.keys(apps[0].env)).not.toContain('DB_PASSWORD');
    expect(Object.keys(apps[0].env)).not.toContain('SESSION_SECRET');
  });
});
