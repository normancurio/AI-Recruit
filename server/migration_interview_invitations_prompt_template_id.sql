-- 业务库 interview_invitations：记录发起面试时选用的 AI 面试官 Prompt 模板。
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_interview_invitations_prompt_template_id.sql

SET @db := DATABASE();

SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'interview_invitations'
    AND COLUMN_NAME = 'prompt_template_id'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE interview_invitations ADD COLUMN prompt_template_id BIGINT UNSIGNED NULL COMMENT ''关联 ai_interview_prompt_templates.id，发起面试时选择的出题 System Prompt 模板'' AFTER resume_screening_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'interview_invitations'
    AND INDEX_NAME = 'idx_invite_prompt_template'
);
SET @sql := IF(
  @has_idx = 0,
  'CREATE INDEX idx_invite_prompt_template ON interview_invitations (prompt_template_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
