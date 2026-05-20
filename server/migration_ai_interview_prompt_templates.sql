-- 业务库：AI 面试出题 Prompt 配置与模板表。
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_ai_interview_prompt_templates.sql

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

SET @default_system_prompt := '你是资深技术面试官。请严格输出恰好 6 道中文面试题，放在一个 JSON 对象里，格式：{"questions":[{"id":"Q1","text":"题干"}]}。要求：\n1) Q1：开场自我介绍题，约 2～3 分钟，可提示包含教育、工作/项目亮点。\n2) Q2、Q3：必须围绕简历中的具体项目、实习或工作经历追问（技术细节、职责边界、难点与结果）；若上文说明无简历则结合 JD 设计两道「项目/交付」情景深挖题。\n3) Q4、Q5、Q6：与岗位 JD 强相关的纯技术题（可含原理、方案对比、排错、性能、安全等），不要行为面或空泛的「你怎么看」。\nid 必须为 Q1 到 Q6 递增；不要 markdown 代码块，不要其它说明文字。';
SET @default_user_prompt := '候选人：{{candidateName}}\n岗位：{{title}}\n部门：{{department}}\nJD：{{jdText}}\n{{resumeBlock}}';

INSERT INTO ai_interview_prompt_configs
  (id, system_prompt, user_prompt_template, enabled, updated_by)
VALUES
  (1, @default_system_prompt, @default_user_prompt, 1, 'migration')
ON DUPLICATE KEY UPDATE
  system_prompt = COALESCE(NULLIF(system_prompt, ''), VALUES(system_prompt)),
  user_prompt_template = COALESCE(NULLIF(user_prompt_template, ''), VALUES(user_prompt_template)),
  enabled = COALESCE(enabled, VALUES(enabled));

INSERT INTO ai_interview_prompt_templates
  (id, name, system_prompt, enabled, is_default, visible_roles, editable_roles, updated_by)
VALUES
  (
    1,
    '申朴面试官AI',
    @default_system_prompt,
    1,
    1,
    JSON_ARRAY('平台管理员', 'AI面试官管理员'),
    JSON_ARRAY('平台管理员', 'AI面试官管理员'),
    'migration'
  )
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  enabled = 1,
  is_default = 1,
  visible_roles = VALUES(visible_roles),
  editable_roles = VALUES(editable_roles);
