-- 简历筛查：结构化详情（可编辑）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screening_profiles.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS resume_screening_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screening_id BIGINT UNSIGNED NOT NULL,
  candidate_name VARCHAR(128) NOT NULL DEFAULT '候选人',
  gender VARCHAR(16) NULL,
  age INT NULL,
  work_experience_years INT NULL,
  job_title VARCHAR(128) NULL,
  school VARCHAR(128) NULL,
  candidate_phone VARCHAR(32) NULL,
  email VARCHAR(128) NULL,
  current_address VARCHAR(255) NULL,
  major VARCHAR(128) NULL,
  education VARCHAR(64) NULL,
  current_position VARCHAR(128) NULL,
  graduation_date VARCHAR(32) NULL,
  arrival_time VARCHAR(64) NULL,
  id_number VARCHAR(64) NULL,
  is_third_party TINYINT NULL,
  expected_salary VARCHAR(128) NULL,
  recruitment_channel VARCHAR(128) NULL,
  has_degree TINYINT NULL,
  is_unified_enrollment TINYINT NULL,
  verifiable TINYINT NULL,
  resume_uploaded TINYINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_resume_profile_screening (screening_id),
  KEY idx_resume_profile_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

