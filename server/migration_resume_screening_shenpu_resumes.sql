-- 申朴统一标准简历：生成状态、PDF 文件索引、结构化内容
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screening_shenpu_resumes.sql

CREATE TABLE IF NOT EXISTS resume_screening_shenpu_resumes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screening_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'generating',
  file_name VARCHAR(255) NULL,
  mime_type VARCHAR(128) NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  storage_path VARCHAR(512) NULL,
  content_json JSON NULL COMMENT '申朴统一标准简历结构化内容',
  progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  progress_stage VARCHAR(64) NULL,
  error_message VARCHAR(500) NULL,
  generated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shenpu_resume_screening (screening_id),
  KEY idx_shenpu_resume_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @db := DATABASE();

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_shenpu_resumes' AND COLUMN_NAME = 'progress_percent'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE resume_screening_shenpu_resumes ADD COLUMN progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER content_json', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_shenpu_resumes' AND COLUMN_NAME = 'progress_stage'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE resume_screening_shenpu_resumes ADD COLUMN progress_stage VARCHAR(64) NULL AFTER progress_percent', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_shenpu_resumes' AND COLUMN_NAME = 'error_message'
);
SET @sql := IF(@has_col = 0, 'ALTER TABLE resume_screening_shenpu_resumes ADD COLUMN error_message VARCHAR(500) NULL AFTER progress_stage', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screening_shenpu_resumes' AND INDEX_NAME = 'idx_shenpu_resume_status'
);
SET @sql := IF(@has_idx = 0, 'CREATE INDEX idx_shenpu_resume_status ON resume_screening_shenpu_resumes (status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
