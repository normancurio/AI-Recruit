-- 简历筛查详情表：增加「当前公司」
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screening_profiles_current_company.sql

USE ai_recruit;

SET @db := DATABASE();

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'current_company'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE resume_screening_profiles ADD COLUMN current_company VARCHAR(255) NULL AFTER current_address',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
