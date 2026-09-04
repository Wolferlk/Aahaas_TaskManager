-- =====================================================================
-- Task Management — additive schema #3: rich Daily Update detail +
-- unattended (auto) submission bookkeeping.
--
-- Same contract as schema.sql: CREATE TABLE IF NOT EXISTS on tm_* only.
-- The existing tm_daily_updates / tm_daily_update_items tables are never
-- altered; everything new lives in these companion tables.
-- =====================================================================

-- One row per daily update: the long-form narrative a submitter records,
-- plus how the update came to exist (typed, AI-assisted, or auto-submitted
-- from GitHub when the 22:00 cut-off passed).
CREATE TABLE IF NOT EXISTS `tm_daily_update_details` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `daily_update_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `update_date` DATE NOT NULL,
  `detailed_summary` MEDIUMTEXT NULL,
  `highlights` TEXT NULL,
  `achievements` TEXT NULL,
  `challenges` TEXT NULL,
  `learnings` TEXT NULL,
  `collaboration` TEXT NULL,
  `next_day_plan` TEXT NULL,
  `focus_area` VARCHAR(200) NULL,
  `work_breakdown` JSON NULL,
  `metrics` JSON NULL,
  `github_metrics` JSON NULL,
  `generated_by` ENUM('USER','AI','AUTO_GITHUB') NOT NULL DEFAULT 'USER',
  `is_auto_submitted` TINYINT(1) NOT NULL DEFAULT 0,
  `needs_review` TINYINT(1) NOT NULL DEFAULT 0,
  `reviewed_at` DATETIME NULL,
  `ai_model` VARCHAR(80) NULL,
  `ai_used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_dud_update` (`daily_update_id`),
  KEY `ix_tm_dud_user_date` (`user_id`,`update_date`),
  KEY `ix_tm_dud_auto` (`is_auto_submitted`,`update_date`),
  CONSTRAINT `fk_tm_dud_update` FOREIGN KEY (`daily_update_id`) REFERENCES `tm_daily_updates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_dud_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per work item: the depth that does not fit the summary line —
-- what was actually done, how, what it affects, and the GitHub evidence.
CREATE TABLE IF NOT EXISTS `tm_daily_update_item_details` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `daily_update_item_id` BIGINT UNSIGNED NOT NULL,
  `daily_update_id` BIGINT UNSIGNED NOT NULL,
  `work_detail` MEDIUMTEXT NULL,
  `technical_notes` TEXT NULL,
  `impact` TEXT NULL,
  `next_steps` TEXT NULL,
  `collaborators` VARCHAR(400) NULL,
  `repos` VARCHAR(400) NULL,
  `links` JSON NULL,
  `commit_shas` JSON NULL,
  `commit_count` INT UNSIGNED NULL,
  `additions` INT UNSIGNED NULL,
  `deletions` INT UNSIGNED NULL,
  `files_changed` INT UNSIGNED NULL,
  `source` ENUM('MANUAL','AI','GITHUB') NOT NULL DEFAULT 'MANUAL',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_dudi_item` (`daily_update_item_id`),
  KEY `ix_tm_dudi_update` (`daily_update_id`),
  CONSTRAINT `fk_tm_dudi_item` FOREIGN KEY (`daily_update_item_id`) REFERENCES `tm_daily_update_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_dudi_update` FOREIGN KEY (`daily_update_id`) REFERENCES `tm_daily_updates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per auto-submission sweep. `run_key` makes a scheduled slot
-- idempotent: the 22:00 sweep for a given day can only be recorded once,
-- so a restarted server never double-submits.
CREATE TABLE IF NOT EXISTS `tm_daily_update_auto_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_key` VARCHAR(80) NOT NULL,
  `run_date` DATE NOT NULL,
  `trigger_source` ENUM('SCHEDULER','CRON','MANUAL') NOT NULL DEFAULT 'SCHEDULER',
  `triggered_by` BIGINT UNSIGNED NULL,
  `users_considered` INT UNSIGNED NOT NULL DEFAULT 0,
  `users_submitted` INT UNSIGNED NOT NULL DEFAULT 0,
  `users_skipped` INT UNSIGNED NOT NULL DEFAULT 0,
  `users_failed` INT UNSIGNED NOT NULL DEFAULT 0,
  `commits_used` INT UNSIGNED NOT NULL DEFAULT 0,
  `detail` JSON NULL,
  `duration_ms` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_duar_key` (`run_key`),
  KEY `ix_tm_duar_date` (`run_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
