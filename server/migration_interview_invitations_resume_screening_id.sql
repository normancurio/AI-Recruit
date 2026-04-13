-- 面试邀请关联简历筛查记录，出题时按 id 精确取简历（需先有 resume_screenings 表）
--   mysql -h<host> -u<user> -p ai_recruit < server/migration_interview_invitations_resume_screening_id.sql

ALTER TABLE interview_invitations
  ADD COLUMN resume_screening_id BIGINT UNSIGNED NULL
    COMMENT '关联 resume_screenings.id，与邀请码中的筛查编号一致'
    AFTER interviewer_user_id,
  ADD KEY idx_invite_resume_screening (resume_screening_id);
