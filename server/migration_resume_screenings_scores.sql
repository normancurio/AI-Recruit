-- resume_screenings：大模型输出的维度评分（0-100）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screenings_scores.sql

USE ai_recruit;

ALTER TABLE resume_screenings
  ADD COLUMN skill_score TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER match_score,
  ADD COLUMN experience_score TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER skill_score,
  ADD COLUMN education_score TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER experience_score,
  ADD COLUMN stability_score TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER education_score;
