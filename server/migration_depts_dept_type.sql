-- 部门业务类型：用于「项目招聘负责人」等场景筛选「招聘」类部门
--   mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_depts_dept_type.sql

ALTER TABLE depts
  ADD COLUMN dept_type VARCHAR(32) NOT NULL DEFAULT '' COMMENT '交付/招聘/其他等，招聘类可选入项目招聘负责人部门' AFTER name;
