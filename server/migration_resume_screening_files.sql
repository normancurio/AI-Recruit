-- 简历筛查：原始上传文件存储索引
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screening_files.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS resume_screening_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screening_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
  file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  storage_path VARCHAR(1024) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_resume_file_screening (screening_id),
  KEY idx_resume_file_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

