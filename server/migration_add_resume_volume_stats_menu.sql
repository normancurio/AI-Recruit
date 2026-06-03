-- 简历量统计菜单（可选：角色管理未单独配置 menu_keys 时，管理员模板已含此项）
-- mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_add_resume_volume_stats_menu.sql

INSERT INTO menus (id, name, type, icon, path, parent_id, level) VALUES
  ('resume-volume-stats', '简历量统计', '菜单', 'TrendingUp', '/recruitment/resume-volume-stats', 'recruitment', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  parent_id = VALUES(parent_id),
  level = VALUES(level);
