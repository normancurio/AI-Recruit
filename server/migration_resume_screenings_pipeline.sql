-- 招聘漏斗阶段：与面试报告、邀请动作联动（需在业务库执行一次）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screenings_pipeline.sql

ALTER TABLE resume_screenings
  ADD COLUMN pipeline_stage VARCHAR(32) NOT NULL DEFAULT 'resume_done'
    COMMENT 'resume_done=筛查完成 invited=已发邀请 report_done=已出面试报告'
    AFTER status;
