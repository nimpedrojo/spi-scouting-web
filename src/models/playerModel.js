const db = require('../db');

async function createPlayersTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS players (
      id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(150) NOT NULL,
      team VARCHAR(150),
      birth_date DATE,
      birth_year INT,
      laterality VARCHAR(5),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function insertPlayer({
  firstName,
  lastName,
  team,
  birthDate,
  birthYear,
  laterality,
}) {
  await db.query(
    'INSERT INTO players (first_name, last_name, team, birth_date, birth_year, laterality) VALUES (?, ?, ?, ?, ?, ?)',
    [firstName, lastName, team, birthDate, birthYear, laterality],
  );
}

async function getPlayersByTeam(team) {
  if (team) {
    const [rows] = await db.query(
      'SELECT * FROM players WHERE team = ? ORDER BY last_name, first_name',
      [team],
    );
    return rows;
  }
  const [rows] = await db.query(
    'SELECT * FROM players ORDER BY team, last_name, first_name',
  );
  return rows;
}

async function getAllPlayers() {
  const [rows] = await db.query(
    'SELECT * FROM players ORDER BY team, last_name, first_name',
  );
  return rows;
}

async function getPlayerById(id) {
  const [rows] = await db.query('SELECT * FROM players WHERE id = ?', [id]);
  return rows[0];
}

async function updatePlayer(id, {
  firstName,
  lastName,
  team,
  birthDate,
  birthYear,
  laterality,
}) {
  const [result] = await db.query(
    'UPDATE players SET first_name = ?, last_name = ?, team = ?, birth_date = ?, birth_year = ?, laterality = ? WHERE id = ?',
    [firstName, lastName, team, birthDate, birthYear, laterality, id],
  );
  return result.affectedRows;
}

async function deletePlayer(id) {
  const [result] = await db.query('DELETE FROM players WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createPlayersTable,
  insertPlayer,
  getPlayersByTeam,
  getAllPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
};
