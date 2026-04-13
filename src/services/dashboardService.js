const db = require('../db');
const { MODULE_KEYS } = require('../shared/constants/moduleKeys');
const { countScoutingTeamReportsByClub } = require('../modules/scoutingTeams/models/scoutingTeamReportModel');

function getSeasonDateRange(seasonName) {
  if (!seasonName || !/^\d{4}\/\d{2}$/.test(seasonName)) {
    return null;
  }
  const startYear = Number(seasonName.slice(0, 4));
  const endYear = startYear + 1;
  return {
    from: `${startYear}-07-01`,
    to: `${endYear}-06-30`,
  };
}

async function getDashboardMetrics(clubId, activeSeason) {
  const seasonRange = getSeasonDateRange(activeSeason ? activeSeason.name : null);
  const params = [clubId, clubId, clubId, clubId];
  let reportsSeasonClause = '';

  if (seasonRange) {
    reportsSeasonClause = ' AND r.created_at >= ? AND r.created_at < DATE_ADD(?, INTERVAL 1 DAY)';
    params.push(seasonRange.from, seasonRange.to);
  }
  params.push(clubId);

  const [rows] = await db.query(
    `SELECT
        (SELECT COUNT(*)
         FROM players p
         WHERE p.is_active = 1
           AND (
             p.club_id = ?
             OR p.club = (SELECT name FROM clubs WHERE id = ? LIMIT 1)
           )) AS total_active_players,
        (SELECT COUNT(*) FROM teams t INNER JOIN seasons s ON s.id = t.season_id WHERE t.club_id = ? AND s.is_active = 1) AS active_teams,
        (SELECT COUNT(*)
         FROM reports r
         WHERE r.club = (SELECT name FROM clubs WHERE id = ? LIMIT 1)${reportsSeasonClause}) AS reports_in_active_season,
        (
          SELECT ROUND(COALESCE(COUNT(tp.player_id) / NULLIF(COUNT(DISTINCT t2.id), 0), 0), 2)
          FROM teams t2
          INNER JOIN seasons s2 ON s2.id = t2.season_id AND s2.is_active = 1
          LEFT JOIN team_players tp ON tp.team_id = t2.id
          WHERE t2.club_id = ?
        ) AS average_players_per_team`,
    params,
  );

  return {
    totalActivePlayers: Number(rows[0].total_active_players || 0),
    activeTeams: Number(rows[0].active_teams || 0),
    reportsInActiveSeason: Number(rows[0].reports_in_active_season || 0),
    averagePlayersPerTeam: Number(rows[0].average_players_per_team || 0),
  };
}

async function getPendingEvaluationsByTeam(clubId, activeSeasonId) {
  const [rows] = await db.query(
    `SELECT
        t.id AS team_id,
        t.name AS team_name,
        cat.name AS category_name,
        sec.name AS section_name,
        COUNT(DISTINCT tp.player_id) AS total_players,
        COUNT(DISTINCT e.player_id) AS evaluated_players,
        COUNT(DISTINCT tp.player_id) - COUNT(DISTINCT e.player_id) AS pending_players,
        ROUND(
          COALESCE(
            (COUNT(DISTINCT e.player_id) / NULLIF(COUNT(DISTINCT tp.player_id), 0)) * 100,
            0
          ),
          2
        ) AS completion_percentage
      FROM teams t
      INNER JOIN seasons s ON s.id = t.season_id AND s.is_active = 1
      INNER JOIN categories cat ON cat.id = t.category_id
      INNER JOIN sections sec ON sec.id = t.section_id
      LEFT JOIN team_players tp ON tp.team_id = t.id
      LEFT JOIN evaluations e
        ON e.team_id = t.id
        AND e.player_id = tp.player_id
        AND e.season_id = ?
      WHERE t.club_id = ?
      GROUP BY t.id, t.name, cat.name, sec.name
      ORDER BY pending_players DESC, t.name ASC`,
    [activeSeasonId, clubId],
  );

  return rows.map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    categoryName: row.category_name,
    sectionName: row.section_name,
    totalPlayers: Number(row.total_players || 0),
    evaluatedPlayers: Number(row.evaluated_players || 0),
    pendingPlayers: Number(row.pending_players || 0),
    completionPercentage: Number(row.completion_percentage || 0),
  }));
}

async function getDashboardData(clubId, activeSeason, options = {}) {
  const activeModuleKeys = Array.isArray(options.activeModuleKeys)
    ? options.activeModuleKeys
    : [];
  const scoutingPlayersEnabled = activeModuleKeys.includes(MODULE_KEYS.SCOUTING_PLAYERS);
  const planningEnabled = activeModuleKeys.includes(MODULE_KEYS.PLANNING);
  const scoutingTeamsEnabled = activeModuleKeys.includes(MODULE_KEYS.SCOUTING_TEAMS);

  const [metrics, pendingByTeam, scoutingTeamsReportCount] = await Promise.all([
    clubId
      ? getDashboardMetrics(clubId, activeSeason)
      : Promise.resolve(null),
    scoutingPlayersEnabled && activeSeason
      ? getPendingEvaluationsByTeam(clubId, activeSeason.id)
      : Promise.resolve([]),
    scoutingTeamsEnabled
      ? countScoutingTeamReportsByClub(clubId)
      : Promise.resolve(0),
  ]);

  return {
    metrics,
    pendingByTeam,
    modules: {
      scoutingPlayersEnabled,
      planningEnabled,
      scoutingTeamsEnabled,
      scoutingTeamsReportCount,
    },
  };
}

module.exports = {
  getSeasonDateRange,
  getDashboardMetrics,
  getPendingEvaluationsByTeam,
  getDashboardData,
};
