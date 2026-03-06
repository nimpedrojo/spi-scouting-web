const EVALUATION_TEMPLATE = [
  {
    key: 'tecnica',
    label: 'Tecnica',
    metrics: [
      { key: 'control', label: 'Control' },
      { key: 'pase', label: 'Pase' },
      { key: 'golpeo', label: 'Golpeo' },
      { key: 'conduccion', label: 'Conduccion' },
    ],
  },
  {
    key: 'tactica',
    label: 'Tactica',
    metrics: [
      { key: 'posicionamiento', label: 'Posicionamiento' },
      { key: 'comprension_juego', label: 'Comprension juego' },
      { key: 'toma_decisiones', label: 'Toma decisiones' },
      { key: 'desmarques', label: 'Desmarques' },
    ],
  },
  {
    key: 'fisica',
    label: 'Fisica',
    metrics: [
      { key: 'velocidad', label: 'Velocidad' },
      { key: 'resistencia', label: 'Resistencia' },
      { key: 'coordinacion', label: 'Coordinacion' },
      { key: 'fuerza', label: 'Fuerza' },
    ],
  },
  {
    key: 'psicologica',
    label: 'Psicologica',
    metrics: [
      { key: 'concentracion', label: 'Concentracion' },
      { key: 'competitividad', label: 'Competitividad' },
      { key: 'confianza', label: 'Confianza' },
      { key: 'reaccion_error', label: 'Reaccion error' },
    ],
  },
  {
    key: 'personalidad',
    label: 'Personalidad',
    metrics: [
      { key: 'compromiso', label: 'Compromiso' },
      { key: 'companerismo', label: 'Companerismo' },
      { key: 'escucha', label: 'Escucha' },
      { key: 'disciplina', label: 'Disciplina' },
    ],
  },
];

function getAllTemplateMetrics() {
  return EVALUATION_TEMPLATE.flatMap((area) => area.metrics.map((metric, index) => ({
    area: area.key,
    areaLabel: area.label,
    metricKey: metric.key,
    metricLabel: metric.label,
    sortOrder: index + 1,
  })));
}

module.exports = {
  EVALUATION_TEMPLATE,
  getAllTemplateMetrics,
};
