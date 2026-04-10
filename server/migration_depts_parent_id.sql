-- 部门上下级：depts.parent_id 指向上级部门 id，NULL 表示顶级
--   mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_depts_parent_id.sql

USE ai_recruit_admin;

ALTER TABLE depts
  ADD COLUMN parent_id VARCHAR(64) NULL COMMENT '上级部门 id' AFTER id,
  ADD KEY idx_depts_parent (parent_id);
