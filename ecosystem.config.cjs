const path = require('path');

const releaseRoot = '/var/www/spi-scouting-deploy/releases';
const sharedRoot = '/var/www/spi-scouting-deploy/shared';
const releasePath = process.env.SPI_RELEASE_PATH;

// Select an explicit immutable release. Never activate a rehearsal directory,
// the original checkout, another application, or an implicit current symlink.
if (!releasePath || !path.isAbsolute(releasePath)
  || path.dirname(releasePath) !== releaseRoot
  || !/^[a-f0-9]{40}$/.test(path.basename(releasePath))) {
  throw new Error('SPI_RELEASE_PATH must be a full commit-SHA directory directly under the production releases root');
}

module.exports = {
  apps: [{
    name: 'soccer-report',
    cwd: releasePath,
    script: path.join(releasePath, 'src', 'server.js'),
    interpreter: '/usr/bin/node',
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    out_file: '/home/ubuntu/.pm2/logs/soccer-report-out.log',
    error_file: '/home/ubuntu/.pm2/logs/soccer-report-error.log',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3002',
      LOG_FILE_PATH: '/var/www/soccer_report/shared/logs/app.log',
      REPORT_TEMPLATE_PATH: path.join(sharedRoot, 'templates', 'report_template.xlsm'),
    },
  }],
};
