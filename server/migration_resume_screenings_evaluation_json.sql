-- resume_screenings：结构化简历评估结果 JSON
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screenings_evaluation_json.sql

USE ai_recruit;

SET @db := DATABASE();
SET @has := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'resume_screenings'
    AND COLUMN_NAME = 'evaluation_json'
);
SET @sql := IF(
  @has > 0,
  'SELECT 1',
  'ALTER TABLE resume_screenings ADD COLUMN evaluation_json JSON NULL COMMENT ''结构化简历评估结果'' AFTER report_summary'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
