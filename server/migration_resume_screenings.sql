-- 简历 AI 筛查记录表（ai_recruit）
--   mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screenings.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS resume_screenings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_code VARCHAR(32) NOT NULL,
  candidate_name VARCHAR(128) NOT NULL DEFAULT '',
  matched_job_title VARCHAR(255) NULL,
  match_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  skill_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  experience_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  education_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  stability_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(64) NOT NULL DEFAULT 'AI分析完成',
  report_summary TEXT NULL,
  resume_plaintext MEDIUMTEXT NULL,
  file_name VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_resume_screen_job (job_code),
  KEY idx_resume_screen_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
