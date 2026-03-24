const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'soccer_report',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

async function ensureDatabaseExists() {
  const databaseName = dbConfig.database;

  if (!databaseName) {
    return;
  }

  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    // Escape identifier manually because placeholders do not apply to database names.
    const escapedDatabaseName = String(databaseName).replace(/`/g, '``');
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${escapedDatabaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

module.exports = pool;
module.exports.dbConfig = dbConfig;
module.exports.ensureDatabaseExists = ensureDatabaseExists;
