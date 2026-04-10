-- 邀请码含 岗位码-账号-简历编号，延长 invite_code
ALTER TABLE interview_invitations MODIFY COLUMN invite_code VARCHAR(128) NOT NULL;
