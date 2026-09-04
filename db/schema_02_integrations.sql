-- =====================================================================
-- Task Management — additive schema #2: mail delivery + GitHub activity
-- Same contract as schema.sql: CREATE TABLE IF NOT EXISTS on tm_* only.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `tm_email_recipients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` ENUM('DAILY_UPDATE','WEEKLY_SUMMARY','APPROVAL','TASK_ALERT') NOT NULL DEFAULT 'DAILY_UPDATE',
  `email` VARCHAR(190) NOT NULL,
  `display_name` VARCHAR(150) NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `mode` ENUM('TO','CC','BCC') NOT NULL DEFAULT 'TO',
  `department_id` BIGINT UNSIGNED NULL,
  `team_id` BIGINT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_email_recipient` (`scope`,`email`,`mode`),
  KEY `ix_tm_email_recipients_active` (`scope`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_email_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` VARCHAR(40) NOT NULL,
  `subject` VARCHAR(300) NOT NULL,
  `recipients` TEXT NOT NULL,
  `entity_type` VARCHAR(40) NULL,
  `entity_id` BIGINT UNSIGNED NULL,
  `triggered_by` BIGINT UNSIGNED NULL,
  `provider` VARCHAR(40) NOT NULL DEFAULT 'MS_GRAPH',
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `error` VARCHAR(600) NULL,
  `duration_ms` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_email_log_scope` (`scope`,`created_at`),
  KEY `ix_tm_email_log_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_github_connections` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `github_login` VARCHAR(120) NOT NULL,
  `github_name` VARCHAR(150) NULL,
  `github_avatar` VARCHAR(400) NULL,
  `github_emails` TEXT NULL,
  `token_cipher` TEXT NOT NULL,
  `token_last4` CHAR(4) NULL,
  `scopes` VARCHAR(300) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_synced_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_github_user` (`user_id`),
  CONSTRAINT `fk_tm_github_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_github_repos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `owner` VARCHAR(120) NOT NULL,
  `repo` VARCHAR(160) NOT NULL,
  `default_branch` VARCHAR(120) NULL,
  `is_selected` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_github_repo` (`user_id`,`owner`,`repo`),
  KEY `ix_tm_github_repo_project` (`project_id`),
  CONSTRAINT `fk_tm_ghrepo_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_ghrepo_project` FOREIGN KEY (`project_id`) REFERENCES `tm_projects` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_github_activity` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `repo_id` BIGINT UNSIGNED NULL,
  `owner` VARCHAR(120) NOT NULL,
  `repo` VARCHAR(160) NOT NULL,
  `commit_sha` CHAR(40) NOT NULL,
  `message` TEXT NULL,
  `branch` VARCHAR(160) NULL,
  `additions` INT UNSIGNED NULL,
  `deletions` INT UNSIGNED NULL,
  `files_changed` INT UNSIGNED NULL,
  `html_url` VARCHAR(500) NULL,
  `committed_at` DATETIME NOT NULL,
  `activity_date` DATE NOT NULL,
  `imported_to_update_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_gh_commit` (`user_id`,`commit_sha`),
  KEY `ix_tm_gh_activity_date` (`user_id`,`activity_date`),
  CONSTRAINT `fk_tm_ghact_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
