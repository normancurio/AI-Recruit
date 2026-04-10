-- 角色可见菜单：roles.menu_keys 存 JSON 数组，元素为管理端侧边栏菜单 id（与 App 内 nav id 一致）
--   mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_roles_menu_keys.sql

USE ai_recruit_admin;

ALTER TABLE roles
  ADD COLUMN menu_keys TEXT NULL COMMENT 'JSON array of sidebar menu ids' AFTER users;
