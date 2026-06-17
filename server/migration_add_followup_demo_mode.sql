-- 演示模式：每道主题必出追问（仅系统默认追问设置）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_add_followup_demo_mode.sql

ALTER TABLE interview_followup_settings
  ADD COLUMN demo_mode TINYINT(1) NOT NULL DEFAULT 0
  AFTER fallback_enabled;
