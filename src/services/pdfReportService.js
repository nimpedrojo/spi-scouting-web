const db = require('../db');
const { requireClubForUser, getActiveSeasonByClub } = require('./teamService');
const { getPlayerAnalytics } = require('./playerAnalyticsService');
const { getReportsForPlayerProfile } = require('../models/reportModel');
const { getPlayerById } = require('../models/playerModel');

const REPORT_RADAR_AREAS = [
  { key: 'tech_total', label: 'Técnica' },
  { key: 'tact_total', label: 'Táctica' },
  { key: 'phys_total', label: 'Física' },
  { key: 'psych_total', label: 'Psicológica' },
  { key: 'pers_total', label: 'Personalidad' },
];

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toISOString().slice(0, 10);
}

function buildInitials(player) {
  return `${(player.first_name || '').charAt(0)}${(player.last_name || '').charAt(0)}`.toUpperCase();
}

function calculateAge(birthDate, birthYear) {
  if (birthDate) {
    const today = new Date();
    const dob = new Date(birthDate);
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age;
  }
  if (birthYear) {
    return new Date().getFullYear() - Number(birthYear);
  }
  return null;
}

function buildProgressItems(analytics, reportsCount) {
  return [
    {
      label: 'Actividad evaluativa',
      value: Math.min(100, analytics.history.totalEvaluations * 20),
      text: `${analytics.history.totalEvaluations} evaluaciones`,
      tone: 'success',
    },
    {
      label: 'Seguimiento por informes',
      value: Math.min(100, reportsCount * 25),
      text: `${reportsCount} informes`,
      tone: 'info',
    },
  ];
}

function buildLatestReportRadar(reports) {
  if (!Array.isArray(reports) || !reports.length) {
    return null;
  }

  const latestReport = reports[0];
  const hasRadarData = REPORT_RADAR_AREAS.some(
    (area) => latestReport[area.key] != null && latestReport[area.key] !== '',
  );

  if (!hasRadarData) {
    return null;
  }

  return {
    dateLabel: formatDate(latestReport.created_at),
    teamLabel: latestReport.team || '-',
    chartJson: JSON.stringify({
      labels: REPORT_RADAR_AREAS.map((area) => area.label),
      datasets: [
        {
          label: 'Último informe',
          data: REPORT_RADAR_AREAS.map((area) => {
            const value = latestReport[area.key] != null ? Number(latestReport[area.key]) : 0;
            return Number.isNaN(value) ? 0 : Number(value.toFixed(2));
          }),
          borderColor: '#0b3b8c',
          backgroundColor: 'rgba(11, 59, 140, 0.14)',
          pointBackgroundColor: '#0b3b8c',
          pointBorderColor: '#ffffff',
        },
      ],
    }),
  };
}

async function getLatestCoachNote(playerId, clubName, player) {
  const [evaluationRows, reportRows] = await Promise.all([
    db.query(
      `SELECT notes, evaluation_date
       FROM evaluations
       WHERE player_id = ? AND notes IS NOT NULL AND TRIM(notes) <> ''
       ORDER BY evaluation_date DESC, created_at DESC
       LIMIT 1`,
      [playerId],
    ),
    db.query(
      `SELECT comments, created_at
       FROM reports
       WHERE club = ? AND player_name = ? AND player_surname = ?
         AND comments IS NOT NULL AND TRIM(comments) <> ''
       ORDER BY created_at DESC
       LIMIT 1`,
      [clubName, player.first_name, player.last_name],
    ),
  ]);

  const evaluationRowsData = evaluationRows[0];
  const reportRowsData = reportRows[0];
  const evaluationNote = evaluationRowsData[0] || null;
  const reportNote = reportRowsData[0] || null;

  if (evaluationNote) {
    return String(evaluationNote.notes).trim();
  }

  if (reportNote) {
    return String(reportNote.comments).trim();
  }

  return '';
}

async function buildPlayerPdfReport(user, playerId, seasonId = null) {
  const club = await requireClubForUser(user);
  if (!club) {
    return null;
  }

  const [player, activeSeason] = await Promise.all([
    getPlayerById(playerId, club.name),
    getActiveSeasonByClub(club.id),
  ]);

  if (!player) {
    return null;
  }

  const analytics = await getPlayerAnalytics(player.id, club.id, seasonId);
  const reports = await getReportsForPlayerProfile({
    clubName: club.name,
    firstName: player.first_name,
    lastName: player.last_name,
  });
  const coachNote = await getLatestCoachNote(player.id, club.name, player);
  const latestReportRadar = buildLatestReportRadar(reports);

  const summary = analytics.summary || {
    ...player,
    team_name: player.relational_team_name || player.team || '',
    section_name: '',
    category_name: '',
    season_name: activeSeason ? activeSeason.name : '',
    dorsal: '',
    positions: '',
  };

  const playerCard = {
    ...summary,
    fullName: `${player.first_name} ${player.last_name}`.trim(),
    initials: buildInitials(player),
    age: calculateAge(player.birth_date, player.birth_year),
    primaryPosition: summary.positions ? String(summary.positions).split(',')[0].trim() : '',
    preferredFoot: player.preferred_foot || player.laterality || '',
    birthDateLabel: formatDate(player.birth_date),
  };

  return {
    club,
    seasonLabel: summary.season_name || (activeSeason ? activeSeason.name : '-'),
    generatedDateLabel: formatDate(new Date()),
    logoPath: '/img/soccerreport-logo.png',
    player: playerCard,
    analytics: {
      ...analytics,
      radarChartJson: JSON.stringify(analytics.radarChartData),
      overallAverageLabel: analytics.history.totalEvaluations ? analytics.overallAverage.toFixed(2) : '-',
      lastEvaluationDateLabel: formatDate(analytics.history.lastEvaluationDate),
    },
    reports: {
      items: reports,
      count: reports.length,
      latestRadar: latestReportRadar,
    },
    coachNote,
    progressItems: buildProgressItems(analytics, reports.length),
  };
}

module.exports = {
  buildPlayerPdfReport,
};
