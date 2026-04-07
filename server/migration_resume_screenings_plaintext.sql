-- 保存简历解析后的纯文本，供小程序面试按简历生成项目题
-- mysql ... ai_recruit < server/migration_resume_screenings_plaintext.sql

USE ai_recruit;

ALTER TABLE resume_screenings
  ADD COLUMN resume_plaintext MEDIUMTEXT NULL AFTER report_summary;
