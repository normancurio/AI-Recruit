-- 简历量统计：menus 表 + 各角色 menu_keys 白名单
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

-- 已有招聘相关菜单的角色，追加 resume-volume-stats（避免重复）
UPDATE roles
SET menu_keys = JSON_ARRAY_APPEND(menu_keys, '$', 'resume-volume-stats')
WHERE menu_keys IS NOT NULL
  AND TRIM(menu_keys) <> ''
  AND JSON_SEARCH(menu_keys, 'one', 'resume-volume-stats') IS NULL
  AND (
    JSON_SEARCH(menu_keys, 'one', 'resume-screening') IS NOT NULL
    OR JSON_SEARCH(menu_keys, 'one', 'recruiter-quality-report') IS NOT NULL
    OR name IN ('平台管理员', '交付经理', '招聘经理', '招聘专员', '分组经理')
  );
