-- Admin demo schema for server.ts (MySQL version)
-- Creates a standalone database to avoid conflicts with ai_recruit.

CREATE DATABASE IF NOT EXISTS ai_recruit_admin
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE ai_recruit_admin;

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255),
  creditCode VARCHAR(64),
  industry VARCHAR(128),
  contact VARCHAR(64),
  phone VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255),
  client VARCHAR(255),
  dept VARCHAR(128),
  manager VARCHAR(64),
  status VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64),
  title VARCHAR(255),
  demand INT,
  location VARCHAR(128),
  skills VARCHAR(255),
  level VARCHAR(64),
  salary VARCHAR(64),
  recruiters JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resumes (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64),
  job VARCHAR(255),
  matchScore INT,
  status VARCHAR(64),
  uploadTime VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS applications (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64),
  job VARCHAR(255),
  resumeScore INT,
  interviewScore INT,
  aiEval TEXT,
  status VARCHAR(64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS depts (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128),
  level INT,
  manager VARCHAR(64),
  count INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64),
  username VARCHAR(64),
  dept VARCHAR(128),
  role VARCHAR(64),
  status VARCHAR(32),
  password_hash VARCHAR(255) NULL,
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64),
  `desc` VARCHAR(255),
  users INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS menus (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64),
  type VARCHAR(32),
  icon VARCHAR(64),
  path VARCHAR(255),
  level INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed data aligned with server.ts
INSERT INTO clients (id, name, creditCode, industry, contact, phone) VALUES
  ('C001', '北京字节跳动科技有限公司', '91110108592343245G', '互联网', '张总', '13800000001'),
  ('C002', '阿里巴巴（中国）网络技术有限公司', '91330100719167708Y', '电子商务', '王总', '13800000002')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  creditCode = VALUES(creditCode),
  industry = VALUES(industry),
  contact = VALUES(contact),
  phone = VALUES(phone);

INSERT INTO projects (id, name, client, dept, manager, status) VALUES
  ('P001', '2026春季核心研发招聘', '北京字节跳动科技有限公司', '华北交付中心', '李交付', '进行中')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  client = VALUES(client),
  dept = VALUES(dept),
  manager = VALUES(manager),
  status = VALUES(status);

INSERT INTO jobs (id, project_id, title, demand, location, skills, level, salary, recruiters) VALUES
  ('J001', 'P001', '高级前端工程师', 5, '北京', 'React, TypeScript', '高级', '30k-50k', JSON_ARRAY('赵招聘', '钱招聘')),
  ('J002', 'P001', 'Java架构师', 2, '北京', 'Java, Spring Cloud', '专家', '50k-80k', JSON_ARRAY('钱招聘'))
ON DUPLICATE KEY UPDATE
  project_id = VALUES(project_id),
  title = VALUES(title),
  demand = VALUES(demand),
  location = VALUES(location),
  skills = VALUES(skills),
  level = VALUES(level),
  salary = VALUES(salary),
  recruiters = VALUES(recruiters);

INSERT INTO resumes (id, name, job, matchScore, status, uploadTime) VALUES
  ('R001', '陈大文', '高级前端工程师', 95, 'AI分析完成', '2026-03-25 10:00'),
  ('R002', '林小明', '高级前端工程师', 78, 'AI分析完成', '2026-03-25 11:30'),
  ('R003', '王五', 'Java架构师', 45, '不匹配', '2026-03-25 14:20')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  job = VALUES(job),
  matchScore = VALUES(matchScore),
  status = VALUES(status),
  uploadTime = VALUES(uploadTime);

INSERT INTO applications (id, name, job, resumeScore, interviewScore, aiEval, status) VALUES
  ('A001', '陈大文', '高级前端工程师', 95, 88, '技术扎实，沟通顺畅，强烈建议推进。', '待初试'),
  ('A002', '林小明', '高级前端工程师', 78, 65, '基础尚可，但高级架构经验不足。', '已淘汰')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  job = VALUES(job),
  resumeScore = VALUES(resumeScore),
  interviewScore = VALUES(interviewScore),
  aiEval = VALUES(aiEval),
  status = VALUES(status);

INSERT INTO depts (id, name, level, manager, count) VALUES
  ('D1', '集团总部', 0, '张总', 120),
  ('D2', '华北交付中心', 1, '李总', 45),
  ('D3', '研发一部', 2, '王经理', 20),
  ('D4', '华南交付中心', 1, '赵总', 38)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  level = VALUES(level),
  manager = VALUES(manager),
  count = VALUES(count);

INSERT INTO users (id, name, username, dept, role, status, password_hash) VALUES
  ('U1', '系统管理员', 'admin', '集团总部', '平台管理员', '正常', 'ai_recruit_init_123456:3fc16a3cd232ec694f1ef13bc3d0a0abe0e13c9ff3775fc5ef01ba7a94f3874266a1daff39ffcd9620bdce13f84e85c6379a1be51b34c1aca2b8244cb894fa5c'),
  ('U2', '李交付', 'li.jiaofu', '华北交付中心', '交付经理', '正常', 'ai_recruit_init_123456:3fc16a3cd232ec694f1ef13bc3d0a0abe0e13c9ff3775fc5ef01ba7a94f3874266a1daff39ffcd9620bdce13f84e85c6379a1be51b34c1aca2b8244cb894fa5c'),
  ('U3', '赵招聘', 'zhao.zhaopin', '研发一部', '招聘人员', '正常', 'ai_recruit_init_123456:3fc16a3cd232ec694f1ef13bc3d0a0abe0e13c9ff3775fc5ef01ba7a94f3874266a1daff39ffcd9620bdce13f84e85c6379a1be51b34c1aca2b8244cb894fa5c')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  username = VALUES(username),
  dept = VALUES(dept),
  role = VALUES(role),
  status = VALUES(status);

INSERT INTO roles (id, name, `desc`, users) VALUES
  ('R1', '平台管理员', '拥有系统所有模块的最高权限', 1),
  ('R2', '交付经理', '负责客户维护与招聘项目管理', 12),
  ('R3', '招聘人员', '负责岗位发布、简历筛查与面试跟进', 45)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  `desc` = VALUES(`desc`),
  users = VALUES(users);

INSERT INTO menus (id, name, type, icon, path, level) VALUES
  ('M1', '项目管理', '目录', 'Briefcase', '/projects', 0),
  ('M1-1', '客户管理', '菜单', 'Building2', '/projects/clients', 1),
  ('M1-2', '招聘项目', '菜单', 'Briefcase', '/projects/list', 1),
  ('M2', '招聘管理', '目录', 'Users', '/recruitment', 0),
  ('M2-1', '岗位查询', '菜单', 'Search', '/recruitment/jobs', 1),
  ('M2-2', '简历筛查 (AI)', '菜单', 'FileText', '/recruitment/resume', 1),
  ('M2-3', '应聘管理', '菜单', 'UserCheck', '/recruitment/applications', 1),
  ('M3', '系统管理', '目录', 'Settings', '/system', 0)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  icon = VALUES(icon),
  path = VALUES(path),
  level = VALUES(level);
