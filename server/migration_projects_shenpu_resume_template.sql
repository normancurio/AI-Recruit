-- 项目管理：每个项目可维护一份申朴简历模板文件
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_projects_shenpu_resume_template.sql

SET @db := DATABASE();

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'shenpu_resume_template_file_name'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE projects ADD COLUMN shenpu_resume_template_file_name VARCHAR(255) NULL AFTER member_count', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'shenpu_resume_template_mime_type'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE projects ADD COLUMN shenpu_resume_template_mime_type VARCHAR(128) NULL AFTER shenpu_resume_template_file_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'shenpu_resume_template_size_bytes'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE projects ADD COLUMN shenpu_resume_template_size_bytes BIGINT UNSIGNED NULL AFTER shenpu_resume_template_mime_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'shenpu_resume_template_storage_path'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE projects ADD COLUMN shenpu_resume_template_storage_path VARCHAR(512) NULL AFTER shenpu_resume_template_size_bytes', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'shenpu_resume_template_uploaded_at'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE projects ADD COLUMN shenpu_resume_template_uploaded_at TIMESTAMP NULL DEFAULT NULL AFTER shenpu_resume_template_storage_path', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
