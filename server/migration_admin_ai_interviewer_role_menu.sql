-- 管理库：AI 面试官角色、菜单、多角色映射表与历史用户角色回填。
-- mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_admin_ai_interviewer_role_menu.sql

SET @db := DATABASE();

SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'menu_keys'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE roles ADD COLUMN menu_keys TEXT NULL COMMENT ''JSON array of sidebar menu ids'' AFTER users',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id VARCHAR(64) NOT NULL,
  role_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  KEY idx_user_roles_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO roles (id, name, `desc`, users, menu_keys)
VALUES (
  'R_AI_INTERVIEWER_MANAGER',
  'AI面试官管理员',
  '可维护 AI 面试官提示词模板',
  0,
  JSON_ARRAY('sys-interview-prompt')
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  `desc` = VALUES(`desc`),
  menu_keys = COALESCE(NULLIF(menu_keys, ''), VALUES(menu_keys));

INSERT INTO menus (id, name, type, icon, path, parent_id, level)
VALUES ('sys-interview-prompt', 'AI面试官', '可见菜单', 'Bot', '/system/ai-interviewer', 'system', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  parent_id = VALUES(parent_id),
  level = VALUES(level);

UPDATE menus
SET type = '可见菜单'
WHERE id IN (
  'workbench',
  'project-list',
  'job-query',
  'resume-screening',
  'resume-library',
  'application-mgmt',
  'sys-dept',
  'sys-user',
  'sys-role',
  'sys-menu',
  'sys-job-role-bases',
  'sys-interview-prompt',
  'sys-ai-interview-settings'
);

INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.name = u.role
WHERE TRIM(COALESCE(u.role, '')) <> '';
