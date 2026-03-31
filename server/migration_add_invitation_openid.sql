-- Migration for existing ai_recruit DB:
-- add openid columns for VoIP invitation routing closure.

USE ai_recruit;

SET @has_interviewer_openid = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'interview_invitations'
    AND COLUMN_NAME = 'interviewer_openid'
);
SET @sql_interviewer_openid = IF(
  @has_interviewer_openid = 0,
  'ALTER TABLE interview_invitations ADD COLUMN interviewer_openid VARCHAR(128) NULL AFTER candidate_user_id',
  'SELECT 1'
);
PREPARE stmt1 FROM @sql_interviewer_openid;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

SET @has_candidate_openid = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'interview_invitations'
    AND COLUMN_NAME = 'candidate_openid'
);
SET @sql_candidate_openid = IF(
  @has_candidate_openid = 0,
  'ALTER TABLE interview_invitations ADD COLUMN candidate_openid VARCHAR(128) NULL AFTER interviewer_openid',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql_candidate_openid;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @has_idx_interviewer_openid = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'interview_invitations'
    AND INDEX_NAME = 'idx_invite_interviewer_openid'
);
SET @sql_idx_interviewer_openid = IF(
  @has_idx_interviewer_openid = 0,
  'ALTER TABLE interview_invitations ADD INDEX idx_invite_interviewer_openid (interviewer_openid)',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql_idx_interviewer_openid;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

SET @has_idx_candidate_openid = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'interview_invitations'
    AND INDEX_NAME = 'idx_invite_candidate_openid'
);
SET @sql_idx_candidate_openid = IF(
  @has_idx_candidate_openid = 0,
  'ALTER TABLE interview_invitations ADD INDEX idx_invite_candidate_openid (candidate_openid)',
  'SELECT 1'
);
PREPARE stmt4 FROM @sql_idx_candidate_openid;
EXECUTE stmt4;
DEALLOCATE PREPARE stmt4;
