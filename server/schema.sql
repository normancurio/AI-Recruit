-- AI-Recruit MySQL schema (for server/index.ts)
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS ai_recruit
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE ai_recruit;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone VARCHAR(32) NULL,
  nickname VARCHAR(64) NULL,
  role ENUM('candidate', 'interviewer') NOT NULL DEFAULT 'candidate',
  status TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_users_phone (phone),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  appid VARCHAR(64) NOT NULL,
  openid VARCHAR(128) NOT NULL,
  session_key VARCHAR(255) NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wechat_appid_openid (appid, openid),
  KEY idx_wechat_user (user_id),
  CONSTRAINT fk_wechat_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interviewer_phone_whitelist (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone VARCHAR(32) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_whitelist_phone (phone),
  KEY idx_whitelist_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  project_code VARCHAR(64) NULL DEFAULT NULL,
  client VARCHAR(255) NULL,
  dept VARCHAR(128) NULL,
  manager VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT '进行中',
  start_date DATE NULL,
  end_date DATE NULL,
  description TEXT NULL,
  member_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id VARCHAR(64) NULL,
  job_code VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  department VARCHAR(255) NULL,
  jd_text TEXT NULL,
  demand INT NOT NULL DEFAULT 1,
  location VARCHAR(128) NULL,
  skills VARCHAR(255) NULL,
  level VARCHAR(64) NULL,
  salary VARCHAR(64) NULL,
  recruiters JSON NULL,
  claimed_by VARCHAR(128) NULL COMMENT '招聘经理认领姓名',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_jobs_job_code (job_code),
  KEY idx_jobs_project (project_id),
  CONSTRAINT fk_jobs_project
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resume_screenings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_code VARCHAR(32) NOT NULL,
  candidate_name VARCHAR(128) NOT NULL DEFAULT '',
  candidate_phone VARCHAR(32) NULL,
  matched_job_title VARCHAR(255) NULL,
  match_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  skill_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  experience_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  education_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  stability_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(64) NOT NULL DEFAULT 'AI分析完成',
  pipeline_stage VARCHAR(32) NOT NULL DEFAULT 'resume_done',
  report_summary TEXT NULL,
  resume_plaintext MEDIUMTEXT NULL,
  file_name VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_resume_screen_job (job_code),
  KEY idx_resume_screen_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invite_code VARCHAR(128) NOT NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  interviewer_user_id BIGINT UNSIGNED NULL,
  resume_screening_id BIGINT UNSIGNED NULL COMMENT '关联 resume_screenings.id',
  candidate_user_id BIGINT UNSIGNED NULL,
  interviewer_openid VARCHAR(128) NULL,
  candidate_openid VARCHAR(128) NULL,
  status ENUM('pending', 'accepted', 'rejected', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
  expires_at DATETIME NULL,
  accepted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_invite_code (invite_code),
  KEY idx_invite_status_expires (status, expires_at),
  KEY idx_invite_interviewer (interviewer_user_id),
  KEY idx_invite_resume_screening (resume_screening_id),
  KEY idx_invite_candidate (candidate_user_id),
  KEY idx_invite_interviewer_openid (interviewer_openid),
  KEY idx_invite_candidate_openid (candidate_openid),
  KEY idx_invite_job (job_id),
  CONSTRAINT fk_invite_job
    FOREIGN KEY (job_id) REFERENCES jobs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_invite_interviewer
    FOREIGN KEY (interviewer_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_invite_candidate
    FOREIGN KEY (candidate_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  invitation_id BIGINT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  candidate_user_id BIGINT UNSIGNED NULL,
  interviewer_user_id BIGINT UNSIGNED NULL,
  candidate_openid VARCHAR(128) NULL,
  interviewer_openid VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  voip_status VARCHAR(32) NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_session_id (session_id),
  KEY idx_session_job (job_id),
  KEY idx_session_candidate_user (candidate_user_id),
  KEY idx_session_interviewer_user (interviewer_user_id),
  KEY idx_session_updated_at (updated_at),
  CONSTRAINT fk_session_invitation
    FOREIGN KEY (invitation_id) REFERENCES interview_invitations(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_session_job
    FOREIGN KEY (job_id) REFERENCES jobs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_session_candidate
    FOREIGN KEY (candidate_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_session_interviewer
    FOREIGN KEY (interviewer_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_questions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  question_no INT NOT NULL,
  question_text TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_question_per_session (session_id, question_no),
  KEY idx_question_session (session_id),
  CONSTRAINT fk_question_session
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  message_type ENUM('transcript', 'qa_answer', 'system') NOT NULL,
  question_id VARCHAR(64) NULL,
  sender_role ENUM('candidate', 'interviewer', 'system') NOT NULL DEFAULT 'candidate',
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_message_session_created (session_id, created_at),
  KEY idx_message_type (message_type),
  CONSTRAINT fk_message_session
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  job_code VARCHAR(32) NOT NULL,
  candidate_name VARCHAR(128) NOT NULL DEFAULT '',
  candidate_openid VARCHAR(128) NULL,
  overall_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  overall_feedback TEXT NULL,
  dimension_scores JSON NULL,
  suggestions JSON NULL,
  risk_points JSON NULL,
  behavior_signals JSON NULL,
  qa_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_report_session (session_id),
  KEY idx_report_job_candidate (job_code, candidate_name),
  KEY idx_report_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional seeds (align with existing mock job codes in frontend/miniapp)
INSERT INTO projects (id, name, project_code, client, dept, manager, status, start_date, end_date, description, member_count)
VALUES
  (
    'P001',
    '2024技术部招聘',
    'PRJ-2024-001',
    '北京字节跳动科技有限公司',
    '技术部',
    '李交付',
    '进行中',
    '2024-01-01',
    '2024-06-30',
    '技术部年度招聘计划，包含前端、后端、测试等多个岗位',
    2
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

INSERT INTO jobs (
  project_id,
  job_code,
  title,
  department,
  jd_text,
  demand,
  location,
  skills,
  level,
  salary,
  recruiters
)
VALUES
  (
    'P001',
    'J001',
    '高级前端工程师',
    '大前端团队',
    '请补充 JD',
    5,
    '北京',
    'React, TypeScript',
    '高级',
    '30k-50k',
    JSON_ARRAY('赵招聘', '钱招聘')
  ),
  (
    'P001',
    'J002',
    'Java架构师',
    '业务中台',
    '请补充 JD',
    2,
    '北京',
    'Java, Spring Cloud',
    '专家',
    '50k-80k',
    JSON_ARRAY('钱招聘')
  ),
  (
    'P001',
    'J003',
    '高级前端架构师',
    '基础架构部',
    '请补充 JD',
    1,
    '北京',
    '架构, 性能',
    '专家',
    '面议',
    JSON_ARRAY()
  )
ON DUPLICATE KEY UPDATE
  project_id = VALUES(project_id),
  title = VALUES(title),
  department = VALUES(department),
  demand = VALUES(demand),
  location = VALUES(location),
  skills = VALUES(skills),
  level = VALUES(level),
  salary = VALUES(salary),
  recruiters = VALUES(recruiters);
