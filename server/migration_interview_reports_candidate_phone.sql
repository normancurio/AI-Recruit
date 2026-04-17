-- 为 interview_reports 增加手机号字段，解决“姓名填错导致报告关联不上”问题
-- 用法：
-- set -a && source .env.local && set +a && mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < server/migration_interview_reports_candidate_phone.sql

USE ai_recruit;

SET @db_name := DATABASE();

SET @has_candidate_phone := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'interview_reports'
    AND COLUMN_NAME = 'candidate_phone'
);
SET @sql_add_candidate_phone := IF(
  @has_candidate_phone = 0,
  'ALTER TABLE interview_reports ADD COLUMN candidate_phone VARCHAR(32) NULL AFTER candidate_name',
  'SELECT "candidate_phone already exists"'
);
PREPARE stmt_add_candidate_phone FROM @sql_add_candidate_phone;
EXECUTE stmt_add_candidate_phone;
DEALLOCATE PREPARE stmt_add_candidate_phone;

SET @has_idx_report_job_phone := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'interview_reports'
    AND INDEX_NAME = 'idx_report_job_phone'
);
SET @sql_add_idx_report_job_phone := IF(
  @has_idx_report_job_phone = 0,
  'ALTER TABLE interview_reports ADD INDEX idx_report_job_phone (job_code, candidate_phone)',
  'SELECT "idx_report_job_phone already exists"'
);
PREPARE stmt_add_idx_report_job_phone FROM @sql_add_idx_report_job_phone;
EXECUTE stmt_add_idx_report_job_phone;
DEALLOCATE PREPARE stmt_add_idx_report_job_phone;
