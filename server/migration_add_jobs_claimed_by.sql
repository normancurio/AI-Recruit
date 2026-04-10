-- 招聘经理认领岗位：写入 jobs.claimed_by（展示名，与登录用户 name 一致为佳）
SET @db := DATABASE();
SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'claimed_by'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE jobs ADD COLUMN claimed_by VARCHAR(128) NULL COMMENT ''招聘经理认领姓名'' AFTER recruiters',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
