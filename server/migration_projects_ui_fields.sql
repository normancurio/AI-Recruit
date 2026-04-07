-- 项目管理页扩展字段（展示编号、周期、描述、成员数）
-- 用法: mysql -h<host> -u<user> -p ai_recruit < server/migration_projects_ui_fields.sql
-- 若列已存在会报错，可忽略对应 ALTER 或手动拆分执行。

USE ai_recruit;

ALTER TABLE projects
  ADD COLUMN project_code VARCHAR(64) NULL DEFAULT NULL COMMENT '展示用编号，如 PRJ-2024-001' AFTER name,
  ADD COLUMN start_date DATE NULL,
  ADD COLUMN end_date DATE NULL,
  ADD COLUMN description TEXT NULL,
  ADD COLUMN member_count INT UNSIGNED NOT NULL DEFAULT 0;
