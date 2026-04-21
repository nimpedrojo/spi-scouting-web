CREATE TABLE IF NOT EXISTS season_team_recommendations (
  id CHAR(36) PRIMARY KEY,
  club_id INT NOT NULL,
  season_id CHAR(36) NOT NULL,
  source_type ENUM('internal', 'scouted') NOT NULL,
  player_id INT NULL,
  scouted_player_id VARCHAR(100) NULL,
  recommended_team_id CHAR(36) NULL,
  recommended_team_label VARCHAR(150) NULL,
  status ENUM('proposed', 'in_review', 'validated', 'discarded') NOT NULL DEFAULT 'proposed',
  notes TEXT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_str_club
    FOREIGN KEY (club_id) REFERENCES clubs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_str_season
    FOREIGN KEY (season_id) REFERENCES seasons(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_str_player
    FOREIGN KEY (player_id) REFERENCES players(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_str_recommended_team
    FOREIGN KEY (recommended_team_id) REFERENCES teams(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_str_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT,
  KEY idx_str_club_season (club_id, season_id),
  KEY idx_str_player (player_id),
  KEY idx_str_scouted_player (scouted_player_id),
  KEY idx_str_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
