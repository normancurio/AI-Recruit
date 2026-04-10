-- 菜单树：为 menus 增加 parent_id，便于「目录」下正确挂载子菜单并在列表中树形展示。
-- 在管理库（如 ai_recruit_admin）执行。

ALTER TABLE menus
  ADD COLUMN parent_id VARCHAR(64) NULL DEFAULT NULL COMMENT '上级菜单 id，顶级为 NULL' AFTER path;

CREATE INDEX idx_menus_parent_id ON menus (parent_id);

-- 与种子数据 id 约定一致：M1-* 挂在 M1 下，M2-* 挂在 M2 下
UPDATE menus SET parent_id = 'M1' WHERE id IN ('M1-1', 'M1-2');
UPDATE menus SET parent_id = 'M2' WHERE id IN ('M2-1', 'M2-2', 'M2-3');
