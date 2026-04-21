-- 为既有 resume_screening_profiles 表补充基础字段
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screening_profiles_extend_fields.sql

USE ai_recruit;

SET @db := DATABASE();

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'job_title'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN job_title VARCHAR(128) NULL AFTER work_experience_years', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'school'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN school VARCHAR(128) NULL AFTER job_title', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'candidate_phone'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN candidate_phone VARCHAR(32) NULL AFTER school', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'email'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN email VARCHAR(128) NULL AFTER candidate_phone', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'current_address'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN current_address VARCHAR(255) NULL AFTER email', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'graduation_date'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN graduation_date VARCHAR(32) NULL AFTER current_position', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'arrival_time'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN arrival_time VARCHAR(64) NULL AFTER graduation_date', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'id_number'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN id_number VARCHAR(64) NULL AFTER arrival_time', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'is_third_party'
);
SET @sql := IF(@has = 0, 'ALTER TABLE resume_screening_profiles ADD COLUMN is_third_party TINYINT NULL AFTER id_number', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

