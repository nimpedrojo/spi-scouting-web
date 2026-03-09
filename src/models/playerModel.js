const db = require('../db');

async function createPlayersTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS players (
      id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(150) NOT NULL,
      club VARCHAR(150),
      club_id INT,
      team VARCHAR(150),
      current_team_id CHAR(36),
      birth_date DATE,
      birth_year INT,
      laterality VARCHAR(5),
      phone VARCHAR(50),
      email VARCHAR(150),
      nationality VARCHAR(100),
      preferred_foot VARCHAR(20),
      avatar_color VARCHAR(20),
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  const alterStatements = [
    'ALTER TABLE players ADD COLUMN club VARCHAR(150)',
    'ALTER TABLE players ADD COLUMN club_id INT',
    'ALTER TABLE players ADD COLUMN current_team_id CHAR(36)',
    'ALTER TABLE players ADD COLUMN phone VARCHAR(50)',
    'ALTER TABLE players ADD COLUMN email VARCHAR(150)',
    'ALTER TABLE players ADD COLUMN nationality VARCHAR(100)',
    'ALTER TABLE players ADD COLUMN preferred_foot VARCHAR(20)',
    'ALTER TABLE players ADD COLUMN avatar_color VARCHAR(20)',
    'ALTER TABLE players ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
  ];

  for (const statement of alterStatements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.query(statement);
    } catch (e) {
      if (e && e.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error altering players table', e);
      }
    }
  }

  try {
    await db.query(
      `ALTER TABLE players
       ADD CONSTRAINT fk_players_current_team
       FOREIGN KEY (current_team_id) REFERENCES teams(id)
       ON DELETE SET NULL`,
    );
  } catch (e) {
    if (
      e
      && e.code !== 'ER_CANT_CREATE_TABLE'
      && e.code !== 'ER_DUP_KEYNAME'
      && e.code !== 'ER_FK_DUP_NAME'
    ) {
      // eslint-disable-next-line no-console
      console.error('Error adding fk_players_current_team', e);
    }
  }
}

async function insertPlayer({
  firstName,
  lastName,
  club = null,
  clubId = null,
  team,
  currentTeamId = null,
  birthDate,
  birthYear,
  laterality,
  phone = null,
  email = null,
  nationality = null,
  preferredFoot = null,
}) {
  const [result] = await db.query(
    `INSERT INTO players (
      first_name, last_name, club, club_id, team, current_team_id, birth_date, birth_year, laterality,
      phone, email, nationality, preferred_foot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      firstName,
      lastName,
      club,
      clubId,
      team,
      currentTeamId,
      birthDate,
      birthYear,
      laterality,
      phone,
      email,
      nationality,
      preferredFoot,
    ],
  );
  return result.insertId;
}

async function getPlayersByTeam(team, club = null) {
  if (team) {
    let sql = `
      SELECT
        p.*,
        tp.dorsal,
        tp.positions,
        t.name AS relational_team_name
      FROM players p
      LEFT JOIN teams t ON t.id = p.current_team_id
      LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = p.current_team_id
      WHERE COALESCE(t.name, p.team) = ?
    `;
    const params = [team];

    if (club) {
      sql += ' AND p.club = ?';
      params.push(club);
    }

    sql += ' ORDER BY p.last_name, p.first_name';

    const [rows] = await db.query(sql, params);
    return rows;
  }

  let sql = `
    SELECT
      p.*,
      tp.dorsal,
      tp.positions,
      sec.name AS section_name,
      cat.name AS category_name,
      s.name AS season_name,
      t.name AS relational_team_name
    FROM players p
    LEFT JOIN teams t ON t.id = p.current_team_id
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = p.current_team_id
    LEFT JOIN sections sec ON sec.id = t.section_id
    LEFT JOIN categories cat ON cat.id = t.category_id
    LEFT JOIN seasons s ON s.id = t.season_id
  `;
  const params = [];

  if (club) {
    sql += ' WHERE p.club = ?';
    params.push(club);
  }

  sql += ' ORDER BY COALESCE(t.name, p.team), p.last_name, p.first_name';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function getAllPlayers(club = null) {
  let sql = `
    SELECT
      p.*,
      tp.dorsal,
      tp.positions,
      sec.name AS section_name,
      cat.name AS category_name,
      s.name AS season_name,
      t.name AS relational_team_name
    FROM players p
    LEFT JOIN teams t ON t.id = p.current_team_id
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = p.current_team_id
    LEFT JOIN sections sec ON sec.id = t.section_id
    LEFT JOIN categories cat ON cat.id = t.category_id
    LEFT JOIN seasons s ON s.id = t.season_id
  `;
  const params = [];

  if (club) {
    sql += ' WHERE p.club = ?';
    params.push(club);
  }

  sql += ' ORDER BY COALESCE(t.name, p.team), p.last_name, p.first_name';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function getPlayerById(id, club = null) {
  let sql = `
    SELECT
      p.*,
      tp.dorsal,
      tp.positions,
      sec.name AS section_name,
      cat.name AS category_name,
      s.name AS season_name,
      t.name AS relational_team_name
    FROM players p
    LEFT JOIN teams t ON t.id = p.current_team_id
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = p.current_team_id
    LEFT JOIN sections sec ON sec.id = t.section_id
    LEFT JOIN categories cat ON cat.id = t.category_id
    LEFT JOIN seasons s ON s.id = t.season_id
    WHERE p.id = ?
  `;
  const params = [id];

  if (club) {
    sql += ' AND p.club = ?';
    params.push(club);
  }

  const [rows] = await db.query(sql, params);
  return rows[0];
}

async function updatePlayer(id, {
  firstName,
  lastName,
  club = null,
  clubId = null,
  team,
  currentTeamId = null,
  birthDate,
  birthYear,
  laterality,
  phone = null,
  email = null,
  nationality = null,
  preferredFoot = null,
}) {
  const [result] = await db.query(
    `UPDATE players
     SET first_name = ?, last_name = ?, team = ?, current_team_id = ?, birth_date = ?, birth_year = ?, laterality = ?,
         phone = ?, email = ?, nationality = ?, preferred_foot = ?, club = ?, club_id = ?
     WHERE id = ?`,
    [
      firstName,
      lastName,
      team,
      currentTeamId,
      birthDate,
      birthYear,
      laterality,
      phone,
      email,
      nationality,
      preferredFoot,
      club,
      clubId,
      id,
    ],
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
