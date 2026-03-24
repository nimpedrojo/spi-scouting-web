const fs = require('fs');
const path = require('path');
const util = require('util');

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function normalizeLevel(level) {
  const value = String(level || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : 'info';
}

const activeLevel = normalizeLevel(process.env.LOG_LEVEL);
const logToFile = process.env.LOG_FILE_PATH ? path.resolve(process.env.LOG_FILE_PATH) : null;
const appName = process.env.APP_NAME || 'soccer_report';

if (logToFile) {
  fs.mkdirSync(path.dirname(logToFile), { recursive: true });
}

function isLevelEnabled(level) {
  return LEVELS[normalizeLevel(level)] <= LEVELS[activeLevel];
}

function sanitizeMeta(meta) {
  if (!meta) {
    return undefined;
  }

  if (meta instanceof Error) {
    return formatError(meta);
  }

  return meta;
}

function writeLine(level, message, meta) {
  const payload = {
    timestamp: new Date().toISOString(),
    app: appName,
    level,
    message,
  };

  const normalizedMeta = sanitizeMeta(meta);
  if (normalizedMeta !== undefined) {
    payload.meta = normalizedMeta;
  }

  const line = JSON.stringify(payload);
  const output = `${line}\n`;

  if (level === 'error') {
    process.stderr.write(output);
  } else {
    process.stdout.write(output);
  }

  if (logToFile) {
    fs.appendFile(logToFile, output, (err) => {
      if (err) {
        process.stderr.write(`${JSON.stringify({
          timestamp: new Date().toISOString(),
          app: appName,
          level: 'error',
          message: 'Error writing log file',
          meta: {
            target: logToFile,
            error: {
              message: err.message,
            },
          },
        })}\n`);
      }
    });
  }
}

function log(level, message, meta) {
  if (!isLevelEnabled(level)) {
    return;
  }

  writeLine(normalizeLevel(level), message, meta);
}

function child(baseMeta = {}) {
  return {
    error(message, meta) {
      log('error', message, { ...baseMeta, ...sanitizeMeta(meta) });
    },
    warn(message, meta) {
      log('warn', message, { ...baseMeta, ...sanitizeMeta(meta) });
    },
    info(message, meta) {
      log('info', message, { ...baseMeta, ...sanitizeMeta(meta) });
    },
    debug(message, meta) {
      log('debug', message, { ...baseMeta, ...sanitizeMeta(meta) });
    },
  };
}

function formatError(err) {
  if (!err) {
    return undefined;
  }

  if (err instanceof Error) {
    const payload = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };

    const errorFields = ['code', 'errno', 'sqlState', 'sqlMessage', 'sql', 'address', 'port', 'syscall'];
    for (const field of errorFields) {
      if (err[field] !== undefined) {
        payload[field] = err[field];
      }
    }

    return payload;
  }

  return {
    message: util.format('%o', err),
  };
}

module.exports = {
  log,
  child,
  formatError,
  error(message, meta) {
    log('error', message, meta);
  },
  warn(message, meta) {
    log('warn', message, meta);
  },
  info(message, meta) {
    log('info', message, meta);
  },
  debug(message, meta) {
    log('debug', message, meta);
  },
};
