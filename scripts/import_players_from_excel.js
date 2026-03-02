/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../src/db');
const { createPlayersTable, insertPlayer } = require('../src/models/playerModel');

async function main() {
  const excelPath =
    process.env.PLAYERS_EXCEL_PATH ||
    '/Users/nimpedrojo/Downloads/Deportistas_2025.xlsx';

  if (!fs.existsSync(excelPath)) {
    console.error(`No se ha encontrado el fichero Excel en: ${excelPath}`);
    process.exit(1);
  }

  console.log('Usando fichero:', excelPath);

  await createPlayersTable();

  const workbook = XLSX.readFile(excelPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  let count = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const row of rows) {
    const firstName = (row.Nombre || '').toString().trim();
    const lastName = (row.Apellidos || '').toString().trim();
    const team = row.Equipo ? row.Equipo.toString().trim() : null;
    const lateralRaw = row.Lateralidad ? row.Lateralidad.toString().trim() : null;

    const birthRaw = row['Fecha Nacimiento'];
    let birthDate = null;
    let birthYear = null;

    if (birthRaw instanceof Date) {
      birthDate = birthRaw.toISOString().slice(0, 10);
      birthYear = birthRaw.getFullYear();
    } else if (typeof birthRaw === 'string' && birthRaw.trim()) {
      const d = new Date(birthRaw);
      if (!Number.isNaN(d.getTime())) {
        birthDate = d.toISOString().slice(0, 10);
        birthYear = d.getFullYear();
      }
    }

    if (!firstName && !lastName) {
      // fila vacía, la saltamos
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await insertPlayer({
      firstName,
      lastName,
      team,
      birthDate,
      birthYear,
      laterality: lateralRaw,
    });
    count += 1;
  }

  console.log(`Importación completada. Jugadores insertados: ${count}`);
  await db.end();
}

main().catch((err) => {
  console.error('Error al importar jugadores desde Excel:', err);
  db.end().finally(() => process.exit(1));
});

