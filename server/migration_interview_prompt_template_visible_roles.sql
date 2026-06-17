-- 业务库：将默认 AI 面试模板 visible_roles 扩展为所有可发起面试的后台角色。
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_interview_prompt_template_visible_roles.sql

UPDATE ai_interview_prompt_templates
SET
  visible_roles = JSON_ARRAY(
    'admin',
    'delivery_manager',
    'recruiter',
    'recruiting_manager',
    'ai_interviewer_manager',
    '平台管理员',
    '交付经理',
    '招聘专员',
    '招聘人员',
    '招聘经理',
    'AI面试官管理员'
  ),
  editable_roles = COALESCE(
    NULLIF(TRIM(editable_roles), ''),
    JSON_ARRAY('admin', 'ai_interviewer_manager', '平台管理员', 'AI面试官管理员')
  )
WHERE id = 1
  AND name = '申朴面试官AI';
