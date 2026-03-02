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
      default_club VARCHAR(150),
      default_team VARCHAR(150),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
}

async function createUser({ name, email, password, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role],
  );
  return result.insertId;
}

async function findUserByEmail(email) {
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0];
}

async function findUserById(id) {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0];
}

async function updateUserAccount(
  id,
  { name, email, defaultClub, defaultTeam, passwordHash = null },
) {
  let sql =
    'UPDATE users SET name = ?, email = ?, default_club = ?, default_team = ?';
  const params = [name, email, defaultClub, defaultTeam];

  if (passwordHash) {
    sql += ', password_hash = ?';
    params.push(passwordHash);
  }

  sql += ' WHERE id = ?';
  params.push(id);

  const [result] = await db.query(sql, params);
  return result.affectedRows;
}

async function getAllUsers() {
  const [rows] = await db.query(
    'SELECT id, name, email, role, default_club, default_team, created_at FROM users ORDER BY created_at DESC',
  );
  return rows;
}

async function updateUserRole(id, role) {
  const [result] = await db.query('UPDATE users SET role = ? WHERE id = ?', [
    role,
    id,
  ]);
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

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [adminEmail]);
  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`Creando usuario admin por defecto (${adminEmail})`);
    await createUser({
      name: 'Administrador',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
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
};
