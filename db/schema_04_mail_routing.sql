-- =====================================================================
-- Task Management — additive schema #4: per-person Daily Update mail
-- routing.
--
-- Same contract as the earlier files: CREATE TABLE IF NOT EXISTS on tm_*
-- only. The global recipient list in tm_email_recipients is untouched;
-- these two tables sit alongside it and say, per author, who their own
-- Daily Update mail goes to and whether it goes at all.
-- =====================================================================

-- One row per (author, address). When the author files a Daily Update the
-- mail is addressed to the global list *plus* the rows here, so
-- sasindu@aahaas.com can have a different reader than anyone else.
CREATE TABLE IF NOT EXISTS `tm_daily_mail_routes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `display_name` VARCHAR(150) NULL,
  `recipient_user_id` BIGINT UNSIGNED NULL,
  `mode` ENUM('TO','CC','BCC') NOT NULL DEFAULT 'TO',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_dmr_route` (`user_id`,`email`,`mode`),
  KEY `ix_tm_dmr_user` (`user_id`,`is_active`),
  CONSTRAINT `fk_tm_dmr_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per author: whether their Daily Update is mailed at all, whether
-- they are copied on it, and whether the global recipient list applies to
-- them. A person with no row here uses the defaults below.
CREATE TABLE IF NOT EXISTS `tm_daily_mail_prefs` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `copy_self` TINYINT(1) NOT NULL DEFAULT 1,
  `use_global_list` TINYINT(1) NOT NULL DEFAULT 1,
  `notify_leader` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` BIGINT UNSIGNED NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_tm_dmp_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
