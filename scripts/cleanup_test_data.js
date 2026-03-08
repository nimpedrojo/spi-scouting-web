const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function cleanupTestData() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'soccer_report',
  });

  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE reports
       SET created_by = NULL
       WHERE created_by IN (
         SELECT id FROM (
           SELECT u.id
           FROM users u
           WHERE u.email LIKE '%@local'
             AND u.email <> ?
         ) AS test_users
       )`,
      [process.env.ADMIN_EMAIL || 'superadmin@local'],
    );

    await connection.query(
      `DELETE FROM team_players
       WHERE team_id IN (
         SELECT id FROM (
           SELECT t.id
           FROM teams t
           INNER JOIN clubs c ON c.id = t.club_id
           WHERE c.code LIKE 'club_%'
         ) AS test_teams
       )`,
    );

    await connection.query(
      `DELETE FROM evaluations
       WHERE club_id IN (
         SELECT id FROM (
           SELECT c.id
           FROM clubs c
           WHERE c.code LIKE 'club_%'
         ) AS test_clubs
       )`,
    );

    await connection.query(
      `DELETE FROM teams
       WHERE club_id IN (
         SELECT id FROM (
           SELECT c.id
           FROM clubs c
           WHERE c.code LIKE 'club_%'
         ) AS test_clubs
       )`,
    );

    await connection.query(
      `DELETE FROM seasons
       WHERE club_id IN (
         SELECT id FROM (
           SELECT c.id
           FROM clubs c
           WHERE c.code LIKE 'club_%'
         ) AS test_clubs
       )`,
    );

    await connection.query(
      `DELETE FROM clubs
       WHERE code LIKE 'club_%'`,
    );

    await connection.query(
      `UPDATE users
       SET club_id = NULL, default_club = NULL, default_team = NULL
       WHERE email LIKE '%@local'
         AND email <> ?`,
      [process.env.ADMIN_EMAIL || 'superadmin@local'],
    );

    const [userResult] = await connection.query(
      `DELETE FROM users
       WHERE email LIKE '%@local'
         AND email <> ?`,
      [process.env.ADMIN_EMAIL || 'superadmin@local'],
    );

    await connection.commit();

    // eslint-disable-next-line no-console
    console.log('Test data cleanup completed.');
    // eslint-disable-next-line no-console
    console.log(`Deleted users: ${userResult.affectedRows}`);
  } catch (error) {
    await connection.rollback();
    // eslint-disable-next-line no-console
    console.error('Error cleaning test data:', error);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

cleanupTestData();
