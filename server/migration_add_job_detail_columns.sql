-- Add admin-style job fields to ai_recruit.jobs (MySQL 8, idempotent)
--   mysql -h<host> -u<user> -p ai_recruit < server/migration_add_job_detail_columns.sql

USE ai_recruit;

SET @db := DATABASE();

-- demand
SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'demand');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN demand INT NOT NULL DEFAULT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'location');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN location VARCHAR(128) NULL');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'skills');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN skills VARCHAR(255) NULL');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'level');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN level VARCHAR(64) NULL');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'salary');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN salary VARCHAR(64) NULL');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'recruiters');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN recruiters JSON NULL');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 与 schema_admin 演示数据对齐（按 job_code 更新，便于已有库升级）
UPDATE projects
SET
  name = '2026春季核心研发招聘',
  client = '北京字节跳动科技有限公司',
  dept = '华北交付中心',
  manager = '李交付',
  status = '进行中'
WHERE id = 'P001';

UPDATE jobs
SET
  title = '高级前端工程师',
  department = '大前端团队',
  demand = 5,
  location = '北京',
  skills = 'React, TypeScript',
  level = '高级',
  salary = '30k-50k',
  recruiters = JSON_ARRAY('赵招聘', '钱招聘')
WHERE job_code = 'J001';

UPDATE jobs
SET
  title = 'Java架构师',
  department = '业务中台',
  demand = 2,
  location = '北京',
  skills = 'Java, Spring Cloud',
  level = '专家',
  salary = '50k-80k',
  recruiters = JSON_ARRAY('钱招聘')
WHERE job_code = 'J002';

UPDATE jobs
SET
  title = '高级前端架构师',
  department = '基础架构部',
  demand = 1,
  location = '北京',
  skills = '架构, 性能',
  level = '专家',
  salary = '面议',
  recruiters = JSON_ARRAY()
WHERE job_code = 'J003';
