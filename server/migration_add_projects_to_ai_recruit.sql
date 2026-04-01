-- Migration: move project dimension into ai_recruit (MySQL 8 compatible)
-- Usage:
--   mysql -h<host> -u<user> -p ai_recruit < server/migration_add_projects_to_ai_recruit.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  client VARCHAR(255) NULL,
  dept VARCHAR(128) NULL,
  manager VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT '进行中',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- jobs.project_id：标准 MySQL 不支持 ADD COLUMN IF NOT EXISTS
SET @db := DATABASE();
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'project_id'
);
SET @sql := IF(@has_col > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN project_id VARCHAR(64) NULL');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND INDEX_NAME = 'idx_jobs_project'
);
SET @sql2 := IF(@has_idx > 0, 'SELECT 1', 'CREATE INDEX idx_jobs_project ON jobs(project_id)');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

INSERT INTO projects (id, name, client, dept, manager, status)
VALUES ('P001', '2026春季核心研发招聘', '业务主库示例客户', '招聘中心', '系统同步', '进行中')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  client = VALUES(client),
  dept = VALUES(dept),
  manager = VALUES(manager),
  status = VALUES(status);

UPDATE jobs
SET project_id = 'P001'
WHERE project_id IS NULL OR project_id = '';
