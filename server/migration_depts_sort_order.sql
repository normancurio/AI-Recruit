-- 管理库 depts：增加同级排序字段，并为历史数据初始化稳定顺序。
-- mysql -h<host> -u<user> -p ai_recruit_admin < server/migration_depts_sort_order.sql

SET @db := DATABASE();

SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'depts'
    AND COLUMN_NAME = 'sort_order'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE depts ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER level',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rownum := 0;
UPDATE depts d
JOIN (
  SELECT id, (@rownum := @rownum + 10) AS next_sort_order
  FROM (
    SELECT id
    FROM depts
    ORDER BY COALESCE(parent_id, ''), COALESCE(level, 0), COALESCE(name, ''), id
  ) ordered_depts
) x ON x.id = d.id
SET d.sort_order = x.next_sort_order
WHERE COALESCE(d.sort_order, 0) = 0;
