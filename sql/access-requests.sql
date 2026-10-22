CREATE TABLE IF NOT EXISTS access_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  organization VARCHAR(150) NOT NULL,
  position VARCHAR(100) NOT NULL DEFAULT '',
  message VARCHAR(1000) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  version INT UNSIGNED NOT NULL DEFAULT 0,
  reviewed_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_access_requests_email (email),
  KEY idx_access_requests_status_created (status, created_at, id),
  CONSTRAINT fk_access_requests_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
