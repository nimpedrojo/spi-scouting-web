const db = require('../db');

async function createReportsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      player_name VARCHAR(100) NOT NULL,
      player_surname VARCHAR(100) NOT NULL,
      year INT,
      club VARCHAR(150),
      team VARCHAR(150),
      laterality VARCHAR(5),
      contact VARCHAR(150),
      pos1 VARCHAR(10),
      pos2 VARCHAR(10),
      pos3 VARCHAR(10),
      pos4 VARCHAR(10),
      overall_rating DECIMAL(4,2),
      comments TEXT,
      tech_total DECIMAL(4,2),
      tact_total DECIMAL(4,2),
      phys_total DECIMAL(4,2),
      psych_total DECIMAL(4,2),
      pers_total DECIMAL(4,2),
      tech_cobertura_balon DECIMAL(4,2),
      tech_conduccion DECIMAL(4,2),
      tech_control DECIMAL(4,2),
      tech_regate DECIMAL(4,2),
      tech_disparo DECIMAL(4,2),
      tech_pase DECIMAL(4,2),
      tech_remate_cabeza DECIMAL(4,2),
      tech_anticipacion DECIMAL(4,2),
      tact_transicion_ataque_defensa DECIMAL(4,2),
      tact_movimientos_sin_balon DECIMAL(4,2),
      tact_ayudas_defensivas DECIMAL(4,2),
      tact_ayudas_ofensivas DECIMAL(4,2),
      tact_desmarques DECIMAL(4,2),
      tact_marcajes DECIMAL(4,2),
      phys_sacrificio DECIMAL(4,2),
      phys_velocidad_punta DECIMAL(4,2),
      phys_velocidad_reaccion DECIMAL(4,2),
      phys_fuerza DECIMAL(4,2),
      phys_potencia DECIMAL(4,2),
      phys_resistencia DECIMAL(4,2),
      phys_coordinacion DECIMAL(4,2),
      psych_concentracion DECIMAL(4,2),
      psych_control_emocional DECIMAL(4,2),
      psych_reaccion_errores_arbitrales DECIMAL(4,2),
      pers_liderazgo DECIMAL(4,2),
      pers_disciplina DECIMAL(4,2),
      pers_reaccion_correcciones_companero DECIMAL(4,2),
      pers_reaccion_correcciones_tecnico DECIMAL(4,2),
      recommendation VARCHAR(50),
      info_reliability DECIMAL(4,2),
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);

  // Intentar añadir nuevas columnas si la tabla ya existía previamente
  const alterStatements = [
    'ALTER TABLE reports ADD COLUMN tech_cobertura_balon DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_conduccion DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_control DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_regate DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_disparo DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_pase DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_remate_cabeza DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tech_anticipacion DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tact_transicion_ataque_defensa DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tact_movimientos_sin_balon DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tact_ayudas_defensivas DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tact_ayudas_ofensivas DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tact_desmarques DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN tact_marcajes DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_sacrificio DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_velocidad_punta DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_velocidad_reaccion DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_fuerza DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_potencia DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_resistencia DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN phys_coordinacion DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN psych_concentracion DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN psych_control_emocional DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN psych_reaccion_errores_arbitrales DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN pers_liderazgo DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN pers_disciplina DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN pers_reaccion_correcciones_companero DECIMAL(4,2)',
    'ALTER TABLE reports ADD COLUMN pers_reaccion_correcciones_tecnico DECIMAL(4,2)',
  ];

  // eslint-disable-next-line no-restricted-syntax
  for (const stmt of alterStatements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.query(stmt);
    } catch (e) {
      // ignore duplicate column errors if columns already exist
      if (e && e.code !== 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.error('Error altering reports table', e);
      }
    }
  }
}

async function createReport(data) {
  const [result] = await db.query('INSERT INTO reports SET ?', [data]);
  return result.insertId;
}

async function getAllReports(club = null) {
  let sql = `
    SELECT r.id,
            r.player_name,
            r.player_surname,
            r.year,
            r.club,
            r.team,
            r.overall_rating,
            r.created_at,
            u.name AS created_by_name
       FROM reports r
       LEFT JOIN users u ON r.created_by = u.id
  `;

  const params = [];
  if (club) {
    sql += ' WHERE r.club = ?';
    params.push(club);
  }

  sql += ' ORDER BY r.created_at DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function getAllReportsRaw(club = null) {
  let sql = 'SELECT * FROM reports';
  const params = [];

  if (club) {
    sql += ' WHERE club = ?';
    params.push(club);
  }

  sql += ' ORDER BY created_at DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function getReportById(id, club = null) {
  let sql = `
    SELECT r.*, u.name AS created_by_name, u.email AS created_by_email
      FROM reports r
      LEFT JOIN users u ON r.created_by = u.id
     WHERE r.id = ?
  `;
  const params = [id];

  if (club) {
    sql += ' AND r.club = ?';
    params.push(club);
  }

  const [rows] = await db.query(sql, params);
  return rows[0];
}

async function updateReport(id, data) {
  const [result] = await db.query('UPDATE reports SET ? WHERE id = ?', [
    data,
    id,
  ]);
  return result.affectedRows;
}

async function deleteReport(id) {
  const [result] = await db.query('DELETE FROM reports WHERE id = ?', [id]);
  return result.affectedRows;
}

async function getReportsForPlayerProfile({ clubName, firstName, lastName }) {
  const [rows] = await db.query(
    `SELECT
        r.id,
        r.player_name,
        r.player_surname,
        r.club,
        r.team,
        r.overall_rating,
        r.created_at,
        u.name AS created_by_name
      FROM reports r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.club = ? AND r.player_name = ? AND r.player_surname = ?
      ORDER BY r.created_at DESC`,
    [clubName, firstName, lastName],
  );
  return rows;
}

async function getReportBenchmarkAverages(report) {
  const [teamRows] = await db.query(
    `SELECT
        COUNT(*) AS sample_size,
        ROUND(AVG(tech_total), 2) AS tech_total,
        ROUND(AVG(tact_total), 2) AS tact_total,
        ROUND(AVG(phys_total), 2) AS phys_total,
        ROUND(AVG(psych_total), 2) AS psych_total,
        ROUND(AVG(pers_total), 2) AS pers_total
      FROM reports
      WHERE club = ? AND team = ?`,
    [report.club, report.team],
  );

  const [clubRows] = await db.query(
    `SELECT
        COUNT(*) AS sample_size,
        ROUND(AVG(tech_total), 2) AS tech_total,
        ROUND(AVG(tact_total), 2) AS tact_total,
        ROUND(AVG(phys_total), 2) AS phys_total,
        ROUND(AVG(psych_total), 2) AS psych_total,
        ROUND(AVG(pers_total), 2) AS pers_total
      FROM reports
      WHERE club = ?`,
    [report.club],
  );

  return {
    teamAverage: teamRows[0]
      ? {
        sampleSize: Number(teamRows[0].sample_size || 0),
        ...teamRows[0],
      }
      : null,
    clubAverage: clubRows[0]
      ? {
        sampleSize: Number(clubRows[0].sample_size || 0),
        ...clubRows[0],
      }
      : null,
  };
}

async function getReportsForPlayerEvolution(report) {
  const [rows] = await db.query(
    `SELECT
        id,
        created_at,
        tech_total,
        tact_total,
        phys_total,
        psych_total,
        pers_total
      FROM reports
      WHERE club = ? AND player_name = ? AND player_surname = ?
      ORDER BY created_at ASC`,
    [report.club, report.player_name, report.player_surname],
  );
  return rows;
}

module.exports = {
  createReportsTable,
  createReport,
  getAllReports,
  getAllReportsRaw,
  getReportById,
  updateReport,
  deleteReport,
  getReportsForPlayerProfile,
  getReportBenchmarkAverages,
  getReportsForPlayerEvolution,
};
