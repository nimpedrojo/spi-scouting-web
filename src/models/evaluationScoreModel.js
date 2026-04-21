const { randomUUID } = require('crypto');
const db = require('../db');

async function createEvaluationScoresTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS evaluation_scores (
      id CHAR(36) PRIMARY KEY,
      evaluation_id CHAR(36) NOT NULL,
      area VARCHAR(50) NOT NULL,
      metric_key VARCHAR(100) NOT NULL,
      metric_label VARCHAR(150) NOT NULL,
      score DECIMAL(5,2) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_evaluation_scores_evaluation
        FOREIGN KEY (evaluation_id) REFERENCES evaluations(id)
        ON DELETE CASCADE,
      KEY idx_evaluation_scores_eval (evaluation_id, area, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql);
}

async function insertEvaluationScores(connection, evaluationId, scores) {
  if (!scores.length) {
    return;
  }

  const values = scores.map((score) => ([
    randomUUID(),
    evaluationId,
    score.area,
    score.metricKey,
    score.metricLabel,
    score.score,
    score.sortOrder,
  ]));

  await connection.query(
    `INSERT INTO evaluation_scores (
      id, evaluation_id, area, metric_key, metric_label, score, sort_order
    ) VALUES ?`,
    [values],
  );
}

async function getScoresByEvaluationId(evaluationId) {
  const [rows] = await db.query(
    `SELECT
        id,
        evaluation_id,
        area,
        metric_key,
        metric_label,
        score,
        sort_order,
        created_at
      FROM evaluation_scores
      WHERE evaluation_id = ?
      ORDER BY area ASC, sort_order ASC, metric_label ASC`,
    [evaluationId],
  );
  return rows;
}

async function listScoresByEvaluationIds(evaluationIds) {
  if (!Array.isArray(evaluationIds) || !evaluationIds.length) {
    return [];
  }

  const placeholders = evaluationIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT
        id,
        evaluation_id,
        area,
        metric_key,
        metric_label,
        score,
        sort_order,
        created_at
      FROM evaluation_scores
      WHERE evaluation_id IN (${placeholders})
      ORDER BY evaluation_id ASC, area ASC, sort_order ASC, metric_label ASC`,
    evaluationIds,
  );
  return rows;
}

module.exports = {
  createEvaluationScoresTable,
  insertEvaluationScores,
  getScoresByEvaluationId,
  listScoresByEvaluationIds,
};
