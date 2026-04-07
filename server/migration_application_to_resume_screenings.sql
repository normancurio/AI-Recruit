-- 将历史管理库 applications 迁移到业务库 ai_recruit.resume_screenings
-- 用法:
--   mysql -h<host> -u<user> -p < server/migration_application_to_resume_screenings.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS resume_screenings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_code VARCHAR(32) NOT NULL,
  candidate_name VARCHAR(128) NOT NULL DEFAULT '',
  matched_job_title VARCHAR(255) NULL,
  match_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(64) NOT NULL DEFAULT 'AI分析完成',
  report_summary TEXT NULL,
  file_name VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_resume_screen_job (job_code),
  KEY idx_resume_screen_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ai_recruit.resume_screenings (
  job_code,
  candidate_name,
  matched_job_title,
  match_score,
  status,
  report_summary,
  file_name
)
SELECT
  COALESCE(
    (
      SELECT j.job_code
      FROM ai_recruit.jobs j
      WHERE j.title COLLATE utf8mb4_general_ci = a.job COLLATE utf8mb4_general_ci
      LIMIT 1
    ),
    'UNKNOWN'
  ) AS job_code,
  COALESCE(a.name, '候选人') AS candidate_name,
  COALESCE(a.job, '') AS matched_job_title,
  LEAST(100, GREATEST(0, COALESCE(a.resumeScore, 0))) AS match_score,
  CASE
    WHEN a.status IS NULL OR a.status = '' THEN '待初面'
    ELSE a.status
  END AS status,
  COALESCE(a.aiEval, '') AS report_summary,
  CONCAT('migration:', COALESCE(a.id, 'legacy')) AS file_name
FROM ai_recruit_admin.applications a
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_recruit.resume_screenings s
  WHERE s.file_name = CONCAT('migration:', COALESCE(a.id, 'legacy'))
);
