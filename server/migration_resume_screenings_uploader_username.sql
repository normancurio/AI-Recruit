-- 简历筛查：上传人账号（用于“谁上传谁可修改手机号”）
SET @db := DATABASE();
SET @has := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'resume_screenings'
    AND COLUMN_NAME = 'uploader_username'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE resume_screenings ADD COLUMN uploader_username VARCHAR(64) NULL COMMENT ''上传人登录账号'' AFTER file_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
