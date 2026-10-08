-- =====================================================================
-- Task Management — additive schema #5: Aahaas Online Work bridge.
--
-- Same contract as the earlier files: CREATE TABLE IF NOT EXISTS on tm_*
-- only. Online Work pushes each saved daily filing here; these tables hold
-- who on that side is who on this side, the one-time codes that join two
-- accounts by hand, and a ledger of every filing that arrived.
-- =====================================================================

-- One row per Online Work account that has ever been tied to a person here.
-- `status = REVOKED` is kept rather than deleted: it is what stops an
-- unlinked account from being matched straight back by email on the next save.
CREATE TABLE IF NOT EXISTS `tm_online_work_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `ow_user_id` CHAR(36) NOT NULL,
  `ow_email` VARCHAR(190) NULL,
  `ow_username` VARCHAR(120) NULL,
  `ow_name` VARCHAR(150) NULL,
  `ow_employee_code` VARCHAR(60) NULL,
  `matched_by` ENUM('EMAIL','USERNAME','CODE') NOT NULL,
  `status` ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `linked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` DATETIME NULL,
  `last_sync_at` DATETIME NULL,
  `sync_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_owl_ow_user` (`ow_user_id`),
  KEY `ix_tm_owl_user` (`user_id`,`status`),
  CONSTRAINT `fk_tm_owl_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A code issued on Online Work and typed in here. Only its hash is stored;
-- the code itself exists on the screen that showed it and nowhere else.
CREATE TABLE IF NOT EXISTS `tm_online_work_link_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` CHAR(64) NOT NULL,
  `ow_user_id` CHAR(36) NOT NULL,
  `ow_email` VARCHAR(190) NULL,
  `ow_username` VARCHAR(120) NULL,
  `ow_name` VARCHAR(150) NULL,
  `ow_employee_code` VARCHAR(60) NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `used_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_owlc_hash` (`code_hash`),
  KEY `ix_tm_owlc_ow_user` (`ow_user_id`,`used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per Online Work person per day: the last filing that arrived, what
-- became of it, and the fingerprint of what was written here — which is how a
-- later push tells "nobody touched it" from "the person edited it here".
CREATE TABLE IF NOT EXISTS `tm_online_work_filings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `ow_user_id` CHAR(36) NOT NULL,
  `filing_date` DATE NOT NULL,
  `daily_update_id` BIGINT UNSIGNED NULL,
  `ow_state` ENUM('draft','submitted') NOT NULL,
  `ow_updated_at` VARCHAR(40) NULL,
  `content_hash` CHAR(64) NOT NULL,
  `tm_fingerprint` CHAR(64) NULL,
  `outcome` ENUM('SYNCED','CONFLICT','DETACHED','SKIPPED') NOT NULL,
  `detail` VARCHAR(500) NULL,
  `mailed` TINYINT(1) NOT NULL DEFAULT 0,
  `payload` JSON NULL,
  `sync_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_owf_day` (`ow_user_id`,`filing_date`),
  KEY `ix_tm_owf_user_date` (`user_id`,`filing_date`),
  KEY `ix_tm_owf_update` (`daily_update_id`),
  CONSTRAINT `fk_tm_owf_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_owf_update` FOREIGN KEY (`daily_update_id`) REFERENCES `tm_daily_updates` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
