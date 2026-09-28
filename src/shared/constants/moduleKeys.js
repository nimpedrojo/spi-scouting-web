const MODULE_KEYS = {
  SCOUTING_PLAYERS: 'scouting_players',
  PLANNING: 'planning',
  SCOUTING_TEAMS: 'scouting_teams',
  PLAYER_LOAD: 'player_load',
};

const DEFAULT_CLUB_MODULES = [
  { key: MODULE_KEYS.SCOUTING_PLAYERS, enabled: true },
  { key: MODULE_KEYS.PLANNING, enabled: false },
  { key: MODULE_KEYS.SCOUTING_TEAMS, enabled: false },
  { key: MODULE_KEYS.PLAYER_LOAD, enabled: false },
];

module.exports = {
  MODULE_KEYS,
  DEFAULT_CLUB_MODULES,
};
