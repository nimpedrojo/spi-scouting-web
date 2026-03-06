const { randomUUID } = require('crypto');
const db = require('../db');

async function createEvaluationTemplatesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS evaluation_templates (
      id CHAR(36) PRIMARY KEY,
      club_id INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      section_id CHAR(36),
      category_id CHAR(36),
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_eval_templates_club
        FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_eval_templates_section
        FOREIGN KEY (section_id) REFERENCES sections(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_eval_templates_category
        FOREIGN KEY (category_id) REFERENCES categories(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function insertEvaluationTemplate({
  clubId,
  name,
  description = null,
  sectionId = null,
  categoryId = null,
  isActive = true,
}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO evaluation_templates (
      id, club_id, name, description, section_id, category_id, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, clubId, name, description, sectionId, categoryId, isActive ? 1 : 0],
  );
  return findEvaluationTemplateById(id);
}

async function findEvaluationTemplateById(id) {
  const [rows] = await db.query(
    `SELECT
        et.*,
        sec.name AS section_name,
        cat.name AS category_name
      FROM evaluation_templates et
      LEFT JOIN sections sec ON sec.id = et.section_id
      LEFT JOIN categories cat ON cat.id = et.category_id
      WHERE et.id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function listEvaluationTemplatesByClub(clubId) {
  const [rows] = await db.query(
    `SELECT
        et.*,
        sec.name AS section_name,
        cat.name AS category_name
      FROM evaluation_templates et
      LEFT JOIN sections sec ON sec.id = et.section_id
      LEFT JOIN categories cat ON cat.id = et.category_id
      WHERE et.club_id = ?
      ORDER BY et.is_active DESC, et.name ASC`,
    [clubId],
  );
  return rows;
}

async function updateEvaluationTemplate(id, {
  name,
  description,
  sectionId,
  categoryId,
  isActive,
}) {
  const [result] = await db.query(
    `UPDATE evaluation_templates
     SET name = ?, description = ?, section_id = ?, category_id = ?, is_active = ?
     WHERE id = ?`,
    [name, description || null, sectionId || null, categoryId || null, isActive ? 1 : 0, id],
  );
  return result.affectedRows;
}

async function deleteEvaluationTemplate(id) {
  const [result] = await db.query('DELETE FROM evaluation_templates WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = {
  createEvaluationTemplatesTable,
  insertEvaluationTemplate,
  findEvaluationTemplateById,
  listEvaluationTemplatesByClub,
  updateEvaluationTemplate,
  deleteEvaluationTemplate,
};
