-- 交付业绩报表菜单
-- mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_add_delivery_performance_report_menu.sql

INSERT INTO menus (id, name, type, icon, path, parent_id, level) VALUES
  ('delivery-performance-report', '交付业绩报表', '菜单', 'FileBarChart', '/recruitment/delivery-performance', 'recruitment', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  parent_id = VALUES(parent_id),
  level = VALUES(level);
