-- 项目级「招聘负责人」：招聘经理名单（JSON 数组，姓名字符串），由交付经理/管理员在项目创建/编辑中维护。
-- 执行：mysql -h<host> -u<user> -p<MYSQL_DATABASE> < server/migration_projects_recruitment_leads.sql

ALTER TABLE projects
  ADD COLUMN recruitment_leads JSON NULL COMMENT '项目招聘经理姓名列表 JSON' AFTER manager;
