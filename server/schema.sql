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
  shenpu_resume_template_file_name VARCHAR(255) NULL,
  shenpu_resume_template_mime_type VARCHAR(128) NULL,
  shenpu_resume_template_size_bytes BIGINT UNSIGNED NULL,
  shenpu_resume_template_storage_path VARCHAR(512) NULL,
  shenpu_resume_template_uploaded_at TIMESTAMP NULL DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS interview_followup_configs (
  job_code VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  max_per_interview INT NOT NULL DEFAULT 3,
  max_per_question INT NOT NULL DEFAULT 1,
  model_wait_ms INT NOT NULL DEFAULT 700,
  short_answer_threshold INT NOT NULL DEFAULT 18,
  fallback_enabled TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NULL,
  prompt TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (job_code),
  CONSTRAINT fk_interview_followup_configs_job
    FOREIGN KEY (job_code) REFERENCES jobs(job_code)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_followup_settings (
  id TINYINT NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  max_per_interview INT NOT NULL DEFAULT 3,
  max_per_question INT NOT NULL DEFAULT 1,
  model_wait_ms INT NOT NULL DEFAULT 700,
  short_answer_threshold INT NOT NULL DEFAULT 18,
  fallback_enabled TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NULL,
  prompt TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
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
  evaluation_json JSON NULL COMMENT '结构化简历评估结果',
  resume_plaintext MEDIUMTEXT NULL,
  file_name VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_resume_screen_job (job_code),
  KEY idx_resume_screen_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resume_screening_shenpu_resumes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screening_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'generating',
  file_name VARCHAR(255) NULL,
  mime_type VARCHAR(128) NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  storage_path VARCHAR(512) NULL,
  content_json JSON NULL COMMENT '申朴统一标准简历结构化内容',
  progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  progress_stage VARCHAR(64) NULL,
  error_message VARCHAR(500) NULL,
  generated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_shenpu_resume_screening (screening_id),
  KEY idx_shenpu_resume_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS interview_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invite_code VARCHAR(128) NOT NULL,
  job_id BIGINT UNSIGNED NOT NULL,
  interviewer_user_id BIGINT UNSIGNED NULL,
  resume_screening_id BIGINT UNSIGNED NULL COMMENT '关联 resume_screenings.id',
  prompt_template_id BIGINT UNSIGNED NULL COMMENT '关联 ai_interview_prompt_templates.id，发起面试时选择的出题 System Prompt 模板',
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
  KEY idx_invite_prompt_template (prompt_template_id),
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

CREATE TABLE IF NOT EXISTS interview_invitation_followup_configs (
  invitation_id BIGINT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  max_per_interview INT NOT NULL DEFAULT 3,
  max_per_question INT NOT NULL DEFAULT 1,
  model_wait_ms INT NOT NULL DEFAULT 700,
  short_answer_threshold INT NOT NULL DEFAULT 18,
  fallback_enabled TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NULL,
  prompt TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (invitation_id)
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

CREATE TABLE IF NOT EXISTS ai_interview_prompt_configs (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  system_prompt MEDIUMTEXT NOT NULL,
  user_prompt_template MEDIUMTEXT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  updated_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_interview_prompt_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  system_prompt MEDIUMTEXT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  is_default TINYINT NOT NULL DEFAULT 0,
  visible_roles TEXT NULL,
  editable_roles TEXT NULL,
  updated_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_interview_prompt_name (name),
  KEY idx_ai_interview_prompt_enabled (enabled),
  KEY idx_ai_interview_prompt_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ai_interview_prompt_templates
  (id, name, system_prompt, enabled, is_default, visible_roles, editable_roles, updated_by)
VALUES
  (
    1,
    '申朴面试官AI',
    '你是资深技术面试官。请严格输出恰好 6 道中文面试题，放在一个 JSON 对象里，格式：{"questions":[{"id":"Q1","text":"题干"},…]}。要求：\n1) Q1：开场自我介绍题，约 2～3 分钟，可提示包含教育、工作/项目亮点。\n2) Q2、Q3：必须围绕简历中的具体项目、实习或工作经历追问（技术细节、职责边界、难点与结果）；若上文说明无简历则结合 JD 设计两道「项目/交付」情景深挖题。\n3) Q4、Q5、Q6：与岗位 JD 强相关的纯技术题（可含原理、方案对比、排错、性能、安全等），不要行为面或空泛的「你怎么看」。\nid 必须为 Q1 到 Q6 递增；不要 markdown 代码块，不要其它说明文字。',
    1,
    1,
    JSON_ARRAY('admin', 'delivery_manager', 'recruiter', 'recruiting_manager', 'ai_interviewer_manager'),
    JSON_ARRAY('admin', 'ai_interviewer_manager'),
    'system'
  )
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  enabled = 1,
  is_default = 1;

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
  candidate_phone VARCHAR(32) NULL,
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
  KEY idx_report_job_phone (job_code, candidate_phone),
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
