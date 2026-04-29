-- 系统管理：标准岗位维护（与 App.tsx NAV_TEMPLATE id 一致）
INSERT INTO menus (id, name, type, icon, path, parent_id, level)
VALUES (
  'sys-job-role-bases',
  '标准岗位',
  '菜单',
  'Tags',
  '/system/job-role-bases',
  'system',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  parent_id = VALUES(parent_id),
  level = VALUES(level);
