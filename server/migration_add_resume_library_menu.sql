-- 已有库补录「简历库」菜单（与 NAV_TEMPLATE / migration_menus_reset_nav_template.sql 一致）
-- 在管理库（如 ai_recruit_admin）执行一次即可。

INSERT INTO menus (id, name, type, icon, path, parent_id, level) VALUES
  ('resume-library', '简历库', '菜单', 'FolderOpen', '/recruitment/resume-library', 'recruitment', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  parent_id = VALUES(parent_id),
  level = VALUES(level);
