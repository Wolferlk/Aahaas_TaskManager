-- =====================================================================
-- Aahaas Task Management System — additive schema (tm_* namespace only)
-- Every statement is CREATE TABLE IF NOT EXISTS. Nothing here alters,
-- drops or truncates any pre-existing Operations System table.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `tm_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('MANAGER','LEADER','EMPLOYEE') NOT NULL DEFAULT 'EMPLOYEE',
  `requested_role` ENUM('MANAGER','LEADER','EMPLOYEE') NULL,
  `status` ENUM('PENDING_APPROVAL','ACTIVE','REJECTED','DISABLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `department_id` BIGINT UNSIGNED NULL,
  `team_id` BIGINT UNSIGNED NULL,
  `job_title` VARCHAR(120) NULL,
  `employee_code` VARCHAR(60) NULL,
  `phone` VARCHAR(40) NULL,
  `avatar_url` VARCHAR(500) NULL,
  `availability` ENUM('AVAILABLE','BUSY','ON_LEAVE','REMOTE','OFFLINE') NOT NULL DEFAULT 'AVAILABLE',
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `approved_by` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NULL,
  `rejection_reason` VARCHAR(500) NULL,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_users_email` (`email`),
  UNIQUE KEY `uq_tm_users_uuid` (`uuid`),
  KEY `ix_tm_users_status` (`status`),
  KEY `ix_tm_users_role` (`role`),
  KEY `ix_tm_users_department` (`department_id`),
  KEY `ix_tm_users_team` (`team_id`),
  KEY `ix_tm_users_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `user_agent` VARCHAR(400) NULL,
  `ip_address` VARCHAR(64) NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_sessions_token` (`token_hash`),
  KEY `ix_tm_sessions_user` (`user_id`),
  KEY `ix_tm_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_tm_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_password_resets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_pwreset_token` (`token_hash`),
  KEY `ix_tm_pwreset_user` (`user_id`),
  CONSTRAINT `fk_tm_pwreset_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_login_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(190) NOT NULL,
  `ip_address` VARCHAR(64) NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_login_attempts` (`email`,`created_at`),
  KEY `ix_tm_login_attempts_ip` (`ip_address`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_departments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `description` TEXT NULL,
  `manager_user_id` BIGINT UNSIGNED NULL,
  `color` VARCHAR(20) NULL,
  `status` ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_departments_code` (`code`),
  KEY `ix_tm_departments_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_teams` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `department_id` BIGINT UNSIGNED NOT NULL,
  `leader_user_id` BIGINT UNSIGNED NULL,
  `description` TEXT NULL,
  `status` ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_teams_code` (`code`),
  KEY `ix_tm_teams_department` (`department_id`),
  KEY `ix_tm_teams_leader` (`leader_user_id`),
  CONSTRAINT `fk_tm_teams_department` FOREIGN KEY (`department_id`) REFERENCES `tm_departments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_team_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `team_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role_in_team` ENUM('LEADER','MEMBER') NOT NULL DEFAULT 'MEMBER',
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `ix_tm_team_members_team` (`team_id`,`is_active`),
  KEY `ix_tm_team_members_user` (`user_id`,`is_active`),
  CONSTRAINT `fk_tm_team_members_team` FOREIGN KEY (`team_id`) REFERENCES `tm_teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_team_members_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `description` TEXT NULL,
  `department_id` BIGINT UNSIGNED NULL,
  `owner_user_id` BIGINT UNSIGNED NULL,
  `leader_user_id` BIGINT UNSIGNED NULL,
  `start_date` DATE NULL,
  `target_date` DATE NULL,
  `status` ENUM('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PLANNING',
  `progress` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `health` ENUM('HEALTHY','NEEDS_ATTENTION','AT_RISK','CRITICAL') NOT NULL DEFAULT 'HEALTHY',
  `health_reasons` JSON NULL,
  `color` VARCHAR(20) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_projects_code` (`code`),
  KEY `ix_tm_projects_status` (`status`),
  KEY `ix_tm_projects_department` (`department_id`),
  KEY `ix_tm_projects_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_project_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role_in_project` VARCHAR(60) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_project_member` (`project_id`,`user_id`),
  KEY `ix_tm_project_members_user` (`user_id`),
  CONSTRAINT `fk_tm_pm_project` FOREIGN KEY (`project_id`) REFERENCES `tm_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_pm_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(80) NOT NULL,
  `color` VARCHAR(20) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_task_categories_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_counters` (
  `scope` VARCHAR(40) NOT NULL,
  `year` SMALLINT UNSIGNED NOT NULL,
  `last_seq` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`scope`,`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_recurring_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `frequency` ENUM('DAILY','WEEKDAYS','WEEKLY','MONTHLY','CUSTOM') NOT NULL,
  `interval_count` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `weekdays` VARCHAR(30) NULL,
  `day_of_month` TINYINT UNSIGNED NULL,
  `starts_on` DATE NULL,
  `ends_on` DATE NULL,
  `next_run_at` DATETIME NULL,
  `last_generated_at` DATETIME NULL,
  `last_generated_key` VARCHAR(60) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_recurring_next` (`is_active`,`next_run_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_number` VARCHAR(40) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT NULL,
  `task_type` ENUM('TASK','BUG','FEATURE','SUPPORT','MEETING','REPORT','OTHER') NOT NULL DEFAULT 'TASK',
  `project_id` BIGINT UNSIGNED NULL,
  `department_id` BIGINT UNSIGNED NULL,
  `team_id` BIGINT UNSIGNED NULL,
  `assignee_id` BIGINT UNSIGNED NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `leader_id` BIGINT UNSIGNED NULL,
  `category_id` BIGINT UNSIGNED NULL,
  `parent_task_id` BIGINT UNSIGNED NULL,
  `recurring_rule_id` BIGINT UNSIGNED NULL,
  `recurrence_key` VARCHAR(60) NULL,
  `priority` ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL DEFAULT 'MEDIUM',
  `status` ENUM('DRAFT','TODO','IN_PROGRESS','BLOCKED','WAITING','REVIEW','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'TODO',
  `visibility` ENUM('PRIVATE','TEAM','DEPARTMENT','MANAGER','PUBLIC') NOT NULL DEFAULT 'TEAM',
  `is_personal` TINYINT(1) NOT NULL DEFAULT 0,
  `start_date` DATETIME NULL,
  `deadline` DATETIME NULL,
  `original_deadline` DATETIME NULL,
  `estimated_hours` DECIMAL(7,2) NULL,
  `actual_hours` DECIMAL(7,2) NULL,
  `progress` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `blocked_reason` VARCHAR(500) NULL,
  `completion_notes` TEXT NULL,
  `ai_summary` TEXT NULL,
  `submitted_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `approved_at` DATETIME NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `cancelled_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_tasks_number` (`task_number`),
  UNIQUE KEY `uq_tm_tasks_recurrence` (`recurring_rule_id`,`recurrence_key`),
  KEY `ix_tm_tasks_assignee` (`assignee_id`,`status`),
  KEY `ix_tm_tasks_creator` (`created_by`),
  KEY `ix_tm_tasks_status` (`status`),
  KEY `ix_tm_tasks_priority` (`priority`),
  KEY `ix_tm_tasks_deadline` (`deadline`),
  KEY `ix_tm_tasks_project` (`project_id`),
  KEY `ix_tm_tasks_team` (`team_id`),
  KEY `ix_tm_tasks_department` (`department_id`),
  KEY `ix_tm_tasks_parent` (`parent_task_id`),
  KEY `ix_tm_tasks_created_at` (`created_at`),
  KEY `ix_tm_tasks_completed_at` (`completed_at`),
  KEY `ix_tm_tasks_deleted` (`deleted_at`),
  CONSTRAINT `fk_tm_tasks_creator` FOREIGN KEY (`created_by`) REFERENCES `tm_users` (`id`),
  CONSTRAINT `fk_tm_tasks_assignee` FOREIGN KEY (`assignee_id`) REFERENCES `tm_users` (`id`),
  CONSTRAINT `fk_tm_tasks_project` FOREIGN KEY (`project_id`) REFERENCES `tm_projects` (`id`),
  CONSTRAINT `fk_tm_tasks_parent` FOREIGN KEY (`parent_task_id`) REFERENCES `tm_tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_assignees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role` ENUM('OWNER','COLLABORATOR','REVIEWER') NOT NULL DEFAULT 'COLLABORATOR',
  `assigned_by` BIGINT UNSIGNED NULL,
  `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `unassigned_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tm_task_assignees_task` (`task_id`),
  KEY `ix_tm_task_assignees_user` (`user_id`),
  CONSTRAINT `fk_tm_ta_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_checklists` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(300) NOT NULL,
  `is_done` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT UNSIGNED NOT NULL DEFAULT 0,
  `done_by` BIGINT UNSIGNED NULL,
  `done_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_checklist_task` (`task_id`),
  CONSTRAINT `fk_tm_checklist_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_dependencies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `depends_on_task_id` BIGINT UNSIGNED NOT NULL,
  `type` ENUM('BLOCKS','BLOCKED_BY','RELATED_TO') NOT NULL DEFAULT 'BLOCKED_BY',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_dep` (`task_id`,`depends_on_task_id`,`type`),
  KEY `ix_tm_dep_target` (`depends_on_task_id`),
  CONSTRAINT `fk_tm_dep_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_dep_other` FOREIGN KEY (`depends_on_task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_comments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `parent_id` BIGINT UNSIGNED NULL,
  `body` MEDIUMTEXT NOT NULL,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `is_ai` TINYINT(1) NOT NULL DEFAULT 0,
  `edited_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `deleted_by` BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tm_comments_task` (`task_id`,`created_at`),
  CONSTRAINT `fk_tm_comments_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_comment_mentions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `comment_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_mention` (`comment_id`,`user_id`),
  KEY `ix_tm_mention_user` (`user_id`),
  CONSTRAINT `fk_tm_mention_comment` FOREIGN KEY (`comment_id`) REFERENCES `tm_task_comments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_attachments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `comment_id` BIGINT UNSIGNED NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(600) NOT NULL,
  `mime_type` VARCHAR(120) NULL,
  `size_bytes` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tm_attach_task` (`task_id`),
  CONSTRAINT `fk_tm_attach_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_status_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(30) NULL,
  `to_status` VARCHAR(30) NOT NULL,
  `changed_by` BIGINT UNSIGNED NULL,
  `reason` VARCHAR(600) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_status_hist_task` (`task_id`,`created_at`),
  CONSTRAINT `fk_tm_status_hist_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_activity_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(60) NOT NULL,
  `field` VARCHAR(60) NULL,
  `old_value` TEXT NULL,
  `new_value` TEXT NULL,
  `meta` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_activity_task` (`task_id`,`created_at`),
  KEY `ix_tm_activity_user` (`user_id`,`created_at`),
  CONSTRAINT `fk_tm_activity_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `description` TEXT NULL,
  `department_id` BIGINT UNSIGNED NULL,
  `team_id` BIGINT UNSIGNED NULL,
  `priority` ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL DEFAULT 'MEDIUM',
  `estimated_hours` DECIMAL(7,2) NULL,
  `task_type` VARCHAR(30) NULL,
  `checklist` JSON NULL,
  `subtasks` JSON NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_templates_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_tags` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(60) NOT NULL,
  `color` VARCHAR(20) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_tag_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_tag_map` (
  `task_id` BIGINT UNSIGNED NOT NULL,
  `tag_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`task_id`,`tag_id`),
  KEY `ix_tm_tagmap_tag` (`tag_id`),
  CONSTRAINT `fk_tm_tagmap_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_tagmap_tag` FOREIGN KEY (`tag_id`) REFERENCES `tm_task_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_task_watchers` (
  `task_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`task_id`,`user_id`),
  CONSTRAINT `fk_tm_watch_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_favorites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `entity_type` ENUM('TASK','PROJECT','REPORT','SAVED_VIEW') NOT NULL,
  `entity_id` BIGINT UNSIGNED NOT NULL,
  `label` VARCHAR(160) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_fav` (`user_id`,`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_daily_updates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `update_date` DATE NOT NULL,
  `raw_text` MEDIUMTEXT NULL,
  `source` ENUM('MANUAL','AI_PARSED','MIXED') NOT NULL DEFAULT 'MANUAL',
  `status` ENUM('DRAFT','SUBMITTED') NOT NULL DEFAULT 'DRAFT',
  `total_hours` DECIMAL(6,2) NULL,
  `summary` TEXT NULL,
  `ai_summary` TEXT NULL,
  `mood` VARCHAR(30) NULL,
  `blockers` TEXT NULL,
  `submitted_at` DATETIME NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_daily_user_date` (`user_id`,`update_date`),
  KEY `ix_tm_daily_date` (`update_date`),
  CONSTRAINT `fk_tm_daily_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_daily_update_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `daily_update_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NULL,
  `topic` VARCHAR(160) NULL,
  `title` VARCHAR(255) NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `description` TEXT NULL,
  `work_type` VARCHAR(60) NULL,
  `status` VARCHAR(30) NULL,
  `priority` VARCHAR(20) NULL,
  `progress` TINYINT UNSIGNED NULL,
  `start_time` TIME NULL,
  `end_time` TIME NULL,
  `hours` DECIMAL(5,2) NULL,
  `blockers` TEXT NULL,
  `outcome` TEXT NULL,
  `tags` VARCHAR(300) NULL,
  `confidence` DECIMAL(4,3) NULL,
  `ai_generated` TINYINT(1) NOT NULL DEFAULT 0,
  `ai_fields` JSON NULL,
  `linked_action` ENUM('NONE','ATTACHED','CREATED') NOT NULL DEFAULT 'NONE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_dui_update` (`daily_update_id`),
  KEY `ix_tm_dui_task` (`task_id`),
  CONSTRAINT `fk_tm_dui_update` FOREIGN KEY (`daily_update_id`) REFERENCES `tm_daily_updates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_daily_update_ai_parses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `daily_update_id` BIGINT UNSIGNED NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `model` VARCHAR(80) NULL,
  `input_text` MEDIUMTEXT NULL,
  `output_json` JSON NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `error` VARCHAR(500) NULL,
  `tokens_in` INT UNSIGNED NULL,
  `tokens_out` INT UNSIGNED NULL,
  `duration_ms` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_aiparse_user` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `type` VARCHAR(60) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NULL,
  `link` VARCHAR(400) NULL,
  `entity_type` VARCHAR(40) NULL,
  `entity_id` BIGINT UNSIGNED NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `priority` ENUM('LOW','NORMAL','HIGH') NOT NULL DEFAULT 'NORMAL',
  `read_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_notif_user` (`user_id`,`read_at`,`created_at`),
  CONSTRAINT `fk_tm_notif_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_approval_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` ENUM('USER_SIGNUP','TASK_COMPLETION','DEADLINE_EXTENSION','TASK_REASSIGNMENT','LEADER_REQUEST','REWARD') NOT NULL,
  `requester_id` BIGINT UNSIGNED NULL,
  `assigned_to` BIGINT UNSIGNED NULL,
  `entity_type` VARCHAR(40) NULL,
  `entity_id` BIGINT UNSIGNED NULL,
  `payload` JSON NULL,
  `reason` TEXT NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `decided_by` BIGINT UNSIGNED NULL,
  `decided_at` DATETIME NULL,
  `decision_comment` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_approvals_status` (`status`,`type`),
  KEY `ix_tm_approvals_entity` (`entity_type`,`entity_id`),
  KEY `ix_tm_approvals_requester` (`requester_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_performance_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `period_year` SMALLINT UNSIGNED NOT NULL,
  `period_month` TINYINT UNSIGNED NOT NULL,
  `metrics` JSON NOT NULL,
  `score` DECIMAL(6,2) NULL,
  `ai_analysis` TEXT NULL,
  `generated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_perf_snapshot` (`user_id`,`period_year`,`period_month`),
  KEY `ix_tm_perf_period` (`period_year`,`period_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_performance_scores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `period_year` SMALLINT UNSIGNED NOT NULL,
  `period_month` TINYINT UNSIGNED NOT NULL,
  `dimension` VARCHAR(60) NOT NULL,
  `raw_value` DECIMAL(8,2) NULL,
  `normalized` DECIMAL(6,2) NULL,
  `weight` DECIMAL(5,2) NULL,
  `weighted` DECIMAL(6,2) NULL,
  `explanation` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_perf_dim` (`user_id`,`period_year`,`period_month`,`dimension`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_rewards` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(60) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `icon` VARCHAR(40) NULL,
  `metric_key` VARCHAR(60) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_reward_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_reward_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reward_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `period_year` SMALLINT UNSIGNED NOT NULL,
  `period_month` TINYINT UNSIGNED NOT NULL,
  `points` INT NOT NULL DEFAULT 0,
  `metric_value` DECIMAL(10,2) NULL,
  `reason` TEXT NULL,
  `ai_explanation` TEXT NULL,
  `status` ENUM('PROPOSED','APPROVED','REJECTED') NOT NULL DEFAULT 'PROPOSED',
  `approved_by` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_reward_assign` (`reward_id`,`user_id`,`period_year`,`period_month`),
  KEY `ix_tm_reward_period` (`period_year`,`period_month`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_badges` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(60) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(400) NULL,
  `icon` VARCHAR(40) NULL,
  `tier` ENUM('BRONZE','SILVER','GOLD','PLATINUM') NOT NULL DEFAULT 'BRONZE',
  `rule_key` VARCHAR(60) NULL,
  `rule_threshold` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_badge_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_user_badges` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `badge_id` BIGINT UNSIGNED NOT NULL,
  `awarded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `context` VARCHAR(300) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_user_badge` (`user_id`,`badge_id`),
  CONSTRAINT `fk_tm_ub_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tm_ub_badge` FOREIGN KEY (`badge_id`) REFERENCES `tm_badges` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_saved_views` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `route` VARCHAR(120) NOT NULL DEFAULT '/tm/tasks',
  `filters` JSON NOT NULL,
  `columns` JSON NULL,
  `is_shared` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_views_user` (`user_id`),
  CONSTRAINT `fk_tm_views_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_user_preferences` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `theme` ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  `sidebar_collapsed` TINYINT(1) NOT NULL DEFAULT 0,
  `dashboard_widgets` JSON NULL,
  `notification_prefs` JSON NULL,
  `timezone` VARCHAR(60) NOT NULL DEFAULT 'Asia/Colombo',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_tm_prefs_user` FOREIGN KEY (`user_id`) REFERENCES `tm_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(60) NULL,
  `entity_id` BIGINT UNSIGNED NULL,
  `old_value` TEXT NULL,
  `new_value` TEXT NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(400) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_audit_user` (`user_id`,`created_at`),
  KEY `ix_tm_audit_entity` (`entity_type`,`entity_id`),
  KEY `ix_tm_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_ai_usage_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `feature` VARCHAR(60) NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `model` VARCHAR(80) NULL,
  `tokens_in` INT UNSIGNED NULL,
  `tokens_out` INT UNSIGNED NULL,
  `duration_ms` INT UNSIGNED NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `error` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_ai_usage` (`feature`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_settings` (
  `setting_key` VARCHAR(80) NOT NULL,
  `value` JSON NOT NULL,
  `description` VARCHAR(300) NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tm_analytics_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `event` VARCHAR(80) NOT NULL,
  `path` VARCHAR(200) NULL,
  `meta` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tm_events` (`event`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
