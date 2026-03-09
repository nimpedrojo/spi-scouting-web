const {
  getReportBenchmarkAverages,
  getReportsForPlayerEvolution,
} = require('../models/reportModel');

const RADAR_AREAS = [
  { key: 'tech_total', label: 'Técnica' },
  { key: 'tact_total', label: 'Táctica' },
  { key: 'phys_total', label: 'Física' },
  { key: 'psych_total', label: 'Psicológica' },
  { key: 'pers_total', label: 'Personalidad' },
];

function toDatasetValues(source) {
  return RADAR_AREAS.map((area) => {
    const value = source && source[area.key] != null ? Number(source[area.key]) : 0;
    return Number.isNaN(value) ? 0 : Number(value.toFixed(2));
  });
}

function formatReportLabel(report, fallback) {
  if (!report || !report.created_at) {
    return fallback;
  }

  const date = new Date(report.created_at);
  const dateLabel = Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
  return `${fallback} · ${dateLabel}`;
}

async function buildReportRadarComparison(report) {
  const benchmarks = await getReportBenchmarkAverages(report);
  const history = await getReportsForPlayerEvolution(report);

  const datasets = [
    {
      label: 'Informe actual',
      data: toDatasetValues(report),
      borderColor: '#0b3b8c',
      backgroundColor: 'rgba(11, 59, 140, 0.16)',
      pointBackgroundColor: '#0b3b8c',
      pointBorderColor: '#ffffff',
    },
  ];

  if (benchmarks.teamAverage && benchmarks.teamAverage.sampleSize > 0) {
    datasets.push({
      label: `Media equipo (${benchmarks.teamAverage.sampleSize})`,
      data: toDatasetValues(benchmarks.teamAverage),
      borderColor: '#0f3d2e',
      backgroundColor: 'rgba(15, 61, 46, 0.12)',
      pointBackgroundColor: '#0f3d2e',
      pointBorderColor: '#ffffff',
    });
  }

  if (benchmarks.clubAverage && benchmarks.clubAverage.sampleSize > 0) {
    datasets.push({
      label: `Media club (${benchmarks.clubAverage.sampleSize})`,
      data: toDatasetValues(benchmarks.clubAverage),
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.12)',
      pointBackgroundColor: '#f59e0b',
      pointBorderColor: '#ffffff',
    });
  }

  history
    .filter((entry) => Number(entry.id) !== Number(report.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-3)
    .forEach((entry, index, arr) => {
      const fallback = arr.length === 1 ? 'Informe previo' : `Histórico ${index + 1}`;
      datasets.push({
        label: formatReportLabel(entry, fallback),
        data: toDatasetValues(entry),
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.08)',
        pointBackgroundColor: '#7c3aed',
        pointBorderColor: '#ffffff',
      });
    });

  return {
    labels: RADAR_AREAS.map((area) => area.label),
    datasets,
  };
}

module.exports = {
  buildReportRadarComparison,
};
