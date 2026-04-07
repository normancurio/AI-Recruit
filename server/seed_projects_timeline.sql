-- 为项目管理列表补充展示编号、时间区间、描述、成员数（可重复执行）
USE ai_recruit;

UPDATE projects SET
  project_code = 'PRJ-2024-001',
  start_date = '2024-01-01',
  end_date = '2024-06-30',
  description = '技术部年度招聘计划，包含前端、后端、测试等多个岗位',
  member_count = 2,
  dept = '技术部',
  manager = '李交付'
WHERE id = 'P001';

INSERT INTO projects (
  id, name, project_code, client, dept, manager, status,
  start_date, end_date, description, member_count
) VALUES (
  'PRJ-2024-002',
  '产品团队扩招',
  'PRJ-2024-002',
  '业务主库',
  '产品部',
  '王经理',
  '进行中',
  '2024-02-01',
  '2024-04-30',
  '产品团队扩展，招聘产品经理和产品运营',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  project_code = VALUES(project_code),
  client = VALUES(client),
  dept = VALUES(dept),
  manager = VALUES(manager),
  status = VALUES(status),
  start_date = VALUES(start_date),
  end_date = VALUES(end_date),
  description = VALUES(description),
  member_count = VALUES(member_count);
