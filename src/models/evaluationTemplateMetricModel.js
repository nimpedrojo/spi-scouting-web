const { randomUUID } = require('crypto');
const db = require('../db');

async function createEvaluationTemplateMetricsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS evaluation_template_metrics (
      id CHAR(36) PRIMARY KEY,
      template_id CHAR(36) NOT NULL,
      area VARCHAR(50) NOT NULL,
      metric_key VARCHAR(100) NOT NULL,
      metric_label VARCHAR(150) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_required TINYINT(1) NOT NULL DEFAULT 1,
      default_weight DECIMAL(8,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_eval_template_metrics_template
        FOREIGN KEY (template_id) REFERENCES evaluation_templates(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function insertTemplateMetrics(templateId, metrics) {
  if (!metrics.length) {
    return;
  }

  const values = metrics.map((metric) => ([
    randomUUID(),
    templateId,
    metric.area,
    metric.metricKey,
    metric.metricLabel,
    metric.sortOrder,
    metric.isRequired ? 1 : 0,
    metric.defaultWeight || null,
  ]));

  await db.query(
    `INSERT INTO evaluation_template_metrics (
      id, template_id, area, metric_key, metric_label, sort_order, is_required, default_weight
    ) VALUES ?`,
    [values],
  );
}

async function getTemplateMetrics(templateId) {
  const [rows] = await db.query(
    `SELECT
        id,
        template_id,
        area,
        metric_key,
        metric_label,
        sort_order,
        is_required,
        default_weight,
        created_at
      FROM evaluation_template_metrics
      WHERE template_id = ?
      ORDER BY FIELD(area, 'tecnica', 'tactica', 'fisica', 'psicologica', 'personalidad'), sort_order ASC`,
    [templateId],
  );
  return rows;
}

async function deleteTemplateMetrics(templateId) {
  await db.query('DELETE FROM evaluation_template_metrics WHERE template_id = ?', [templateId]);
}

module.exports = {
  createEvaluationTemplateMetricsTable,
  insertTemplateMetrics,
  getTemplateMetrics,
  deleteTemplateMetrics,
};
