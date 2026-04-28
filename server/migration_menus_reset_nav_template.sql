-- 菜单管理与侧边栏 NAV_TEMPLATE 对齐：清空旧 M1/M2 等种子，仅保留当前实际导航结构。
-- 在管理库（如 ai_recruit_admin）执行。

SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM menus;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO menus (id, name, type, icon, path, parent_id, level) VALUES
  ('workbench', '工作台', '菜单', 'LayoutDashboard', '/workbench', NULL, 0),
  ('projects', '岗位管理', '目录', 'Briefcase', '/projects', NULL, 0),
  ('project-list', '项目管理', '菜单', 'Briefcase', '/projects/list', 'projects', 1),
  ('job-query', '岗位分配', '菜单', 'UserCog', '/recruitment/jobs', 'projects', 1),
  ('recruitment', '招聘管理', '目录', 'Users', '/recruitment', NULL, 0),
  ('resume-screening', '简历筛查', '菜单', 'FileText', '/recruitment/resume', 'recruitment', 1),
  ('resume-library', '简历库', '菜单', 'FolderOpen', '/recruitment/resume-library', 'recruitment', 1),
  ('application-mgmt', '初面管理', '菜单', 'UserCheck', '/recruitment/applications', 'recruitment', 1),
  ('system', '系统管理', '目录', 'Settings', '/system', NULL, 0),
  ('sys-dept', '部门管理', '菜单', 'Network', '/system/dept', 'system', 1),
  ('sys-user', '用户管理', '菜单', 'UserCog', '/system/users', 'system', 1),
  ('sys-role', '角色管理', '菜单', 'Shield', '/system/roles', 'system', 1),
  ('sys-menu', '菜单管理', '菜单', 'Menu', '/system/menus', 'system', 1);
