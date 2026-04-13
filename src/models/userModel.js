const db = require('../db');
const bcrypt = require('bcryptjs');

async function createUsersTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      club_id INT NULL,
      default_club VARCHAR(150),
      default_team VARCHAR(150),
      processiq_username VARCHAR(150),
      processiq_password VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_users_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  // Añadimos la columna role si la tabla ya existía sin ella
  try {
    await db.query('ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT \'user\'');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error altering users table', e);
    }
  }

  // Añadimos columnas de configuración por defecto si no existían
  try {
    await db.query('ALTER TABLE users ADD COLUMN club_id INT NULL');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding club_id column', e);
    }
  }
  try {
    await db.query('ALTER TABLE users ADD COLUMN default_club VARCHAR(150)');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding default_club column', e);
    }
  }
  try {
    await db.query('ALTER TABLE users ADD COLUMN default_team VARCHAR(150)');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding default_team column', e);
    }
  }
  try {
    await db.query('ALTER TABLE users ADD COLUMN default_team_id CHAR(36) NULL');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding default_team_id column', e);
    }
  }
  try {
    await db.query('ALTER TABLE users ADD COLUMN processiq_username VARCHAR(150)');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding processiq_username column', e);
    }
  }
  try {
    await db.query('ALTER TABLE users ADD COLUMN processiq_password VARCHAR(255)');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_FIELDNAME') {
      // eslint-disable-next-line no-console
      console.error('Error adding processiq_password column', e);
    }
  }

  try {
    await db.query(
      `ALTER TABLE users
       ADD CONSTRAINT fk_users_club
       FOREIGN KEY (club_id) REFERENCES clubs(id)
       ON DELETE SET NULL`,
    );
  } catch (e) {
    if (
      e
      && e.code !== 'ER_FK_DUP_NAME'
      && e.code !== 'ER_DUP_KEYNAME'
      && e.code !== 'ER_CANT_CREATE_TABLE'
    ) {
      // eslint-disable-next-line no-console
      console.error('Error adding fk_users_club', e);
    }
  }

  try {
    await db.query(
      `ALTER TABLE users
       ADD CONSTRAINT fk_users_default_team
       FOREIGN KEY (default_team_id) REFERENCES teams(id)
       ON DELETE SET NULL`,
    );
  } catch (e) {
    if (
      e
      && e.code !== 'ER_FK_DUP_NAME'
      && e.code !== 'ER_DUP_KEYNAME'
      && e.code !== 'ER_CANT_CREATE_TABLE'
    ) {
      // eslint-disable-next-line no-console
      console.error('Error adding fk_users_default_team', e);
    }
  }
}

async function createUser({
  name,
  email,
  password,
  role = 'user',
  clubId = null,
  defaultClub = null,
  defaultTeam = null,
  defaultTeamId = null,
  processIqUsername = null,
  processIqPassword = null,
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    `INSERT INTO users (
      name, email, password_hash, role, club_id, default_club, default_team, default_team_id
      , processiq_username, processiq_password
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, email, passwordHash, role, clubId, defaultClub, defaultTeam, defaultTeamId, processIqUsername, processIqPassword],
  );
  return result.insertId;
}

async function findUserByEmail(email) {
  const [rows] = await db.query(
    `SELECT
      u.*,
      c.name AS club_name,
      dt.name AS default_team_name
    FROM users u
    LEFT JOIN clubs c ON c.id = u.club_id
    LEFT JOIN teams dt ON dt.id = u.default_team_id
    WHERE u.email = ?`,
    [email],
  );
  return rows[0];
}

async function findUserById(id) {
  const [rows] = await db.query(
    `SELECT
      u.*,
      c.name AS club_name,
      dt.name AS default_team_name
    FROM users u
    LEFT JOIN clubs c ON c.id = u.club_id
    LEFT JOIN teams dt ON dt.id = u.default_team_id
    WHERE u.id = ?`,
    [id],
  );
  return rows[0];
}

async function updateUserAccount(
  id,
  {
    name,
    email,
    clubId,
    defaultClub,
    defaultTeam,
    defaultTeamId,
    processIqUsername,
    processIqPassword,
    passwordHash = null,
  },
) {
  let sql = 'UPDATE users SET name = ?, email = ?';
  const params = [name, email];

  if (clubId !== undefined) {
    sql += ', club_id = ?';
    params.push(clubId);
  }

  sql += ', default_club = ?, default_team = ?';
  params.push(defaultClub, defaultTeam);

  if (defaultTeamId !== undefined) {
    sql += ', default_team_id = ?';
    params.push(defaultTeamId);
  }

  if (processIqUsername !== undefined) {
    sql += ', processiq_username = ?';
    params.push(processIqUsername);
  }

  if (processIqPassword !== undefined) {
    sql += ', processiq_password = ?';
    params.push(processIqPassword);
  }

  if (passwordHash) {
    sql += ', password_hash = ?';
    params.push(passwordHash);
  }

  sql += ' WHERE id = ?';
  params.push(id);

  const [result] = await db.query(sql, params);
  return result.affectedRows;
}

async function getAllUsers(club = null) {
  let sql =
    `SELECT
      u.id,
      u.name,
      u.email,
      u.role,
      u.club_id,
      u.default_club,
      u.default_team,
      u.default_team_id,
      u.created_at,
      c.name AS club_name,
      dt.name AS default_team_name
    FROM users u
    LEFT JOIN clubs c ON c.id = u.club_id
    LEFT JOIN teams dt ON dt.id = u.default_team_id`;
  const params = [];

  if (club) {
    sql += ' WHERE u.default_club = ?';
    params.push(club);
  }

  sql += ' ORDER BY u.created_at DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function updateUserRole(id, role) {
  let sql = 'UPDATE users SET role = ?';
  const params = [role];

  if (role === 'superadmin') {
    sql += ', club_id = NULL, default_club = NULL, default_team = NULL, default_team_id = NULL';
  }

  sql += ' WHERE id = ?';
  params.push(id);

  const [result] = await db.query(sql, params);
  return result.affectedRows;
}

async function deleteUser(id) {
  // Desvincular informes del usuario antes de borrarlo para evitar errores de clave foránea
  await db.query('UPDATE reports SET created_by = NULL WHERE created_by = ?', [
    id,
  ]);
  const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows;
}

async function countAdminsByClub(club) {
  if (!club) {
    return 0;
  }
  const [rows] = await db.query(
    'SELECT COUNT(*) AS total FROM users WHERE default_club = ? AND role = \'admin\'',
    [club],
  );
  return rows[0] ? rows[0].total : 0;
}

async function syncUserClubAssignments() {
  await db.query(
    `UPDATE users u
     INNER JOIN clubs c ON c.name = u.default_club
     SET u.club_id = c.id
     WHERE u.club_id IS NULL AND u.default_club IS NOT NULL`,
  );
}

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [adminEmail]);
  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`Creando usuario superadmin por defecto (${adminEmail})`);
    await createUser({
      name: 'Administrador',
      email: adminEmail,
      password: adminPassword,
      role: 'superadmin',
    });
  }
}

module.exports = {
  createUsersTable,
  createUser,
  findUserByEmail,
  findUserById,
  updateUserAccount,
  getAllUsers,
  updateUserRole,
  deleteUser,
  ensureAdminUser,
  countAdminsByClub,
  syncUserClubAssignments,
};
