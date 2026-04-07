-- 面试答题完成后落库的结构化报告（管理后台“初面管理 -> 面试报告”使用）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_interview_reports.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS interview_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  job_code VARCHAR(32) NOT NULL,
  candidate_name VARCHAR(128) NOT NULL DEFAULT '',
  candidate_openid VARCHAR(128) NULL,
  overall_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  overall_feedback TEXT NULL,
  dimension_scores JSON NULL,
  suggestions JSON NULL,
  risk_points JSON NULL,
  behavior_signals JSON NULL,
  qa_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_report_session (session_id),
  KEY idx_report_job_candidate (job_code, candidate_name),
  KEY idx_report_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
