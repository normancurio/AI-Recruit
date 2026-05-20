-- 系统管理：AI 面试设置菜单
-- mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_add_ai_interview_settings_menu.sql

INSERT INTO menus (id, name, type, icon, path, parent_id, level)
VALUES ('sys-ai-interview-settings', 'AI面试设置', '菜单', 'Sparkles', '/system/ai-interview-settings', 'system', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  parent_id = VALUES(parent_id),
  level = VALUES(level);
