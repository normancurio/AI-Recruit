-- 简历筛查：候选人手机号（上传时填写）
SET @db := DATABASE();
SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'resume_screenings' AND COLUMN_NAME = 'candidate_phone'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE resume_screenings ADD COLUMN candidate_phone VARCHAR(32) NULL COMMENT ''候选人手机号'' AFTER candidate_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
