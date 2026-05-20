-- AI 面试追问策略
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_interview_followup_configs.sql

CREATE TABLE IF NOT EXISTS interview_followup_settings (
  id TINYINT NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  max_per_interview INT NOT NULL DEFAULT 3,
  max_per_question INT NOT NULL DEFAULT 1,
  model_wait_ms INT NOT NULL DEFAULT 700,
  short_answer_threshold INT NOT NULL DEFAULT 18,
  fallback_enabled TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NULL,
  prompt TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interview_followup_configs (
  job_code VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  max_per_interview INT NOT NULL DEFAULT 3,
  max_per_question INT NOT NULL DEFAULT 1,
  model_wait_ms INT NOT NULL DEFAULT 700,
  short_answer_threshold INT NOT NULL DEFAULT 18,
  fallback_enabled TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NULL,
  prompt TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (job_code),
  CONSTRAINT fk_interview_followup_configs_job
    FOREIGN KEY (job_code) REFERENCES jobs(job_code)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interview_invitation_followup_configs (
  invitation_id BIGINT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  max_per_interview INT NOT NULL DEFAULT 3,
  max_per_question INT NOT NULL DEFAULT 1,
  model_wait_ms INT NOT NULL DEFAULT 700,
  short_answer_threshold INT NOT NULL DEFAULT 18,
  fallback_enabled TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NULL,
  prompt TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (invitation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
