-- 岗位表 jobs：补齐 department、jd_text（与 server/schema.sql 一致，可重复执行）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_jobs_department_jd.sql

USE ai_recruit;

SET @db := DATABASE();

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'department');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN department VARCHAR(255) NULL AFTER title');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'jd_text');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE jobs ADD COLUMN jd_text TEXT NULL AFTER department');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
