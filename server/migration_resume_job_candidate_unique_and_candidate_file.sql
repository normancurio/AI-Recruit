-- 同人同岗防重复 + 候选人维度简历原件去重（需已执行 migration_resume_candidates_and_screening_fk.sql）
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_job_candidate_unique_and_candidate_file.sql

USE ai_recruit;

-- 若列已存在会报错，可注释掉对应行后重跑
ALTER TABLE resume_candidates
  ADD COLUMN last_file_sha256 CHAR(64) NULL DEFAULT NULL COMMENT '最近一次上传简历原件 SHA256(hex)，小写' AFTER display_name;
ALTER TABLE resume_candidates
  ADD COLUMN last_storage_key VARCHAR(512) NULL DEFAULT NULL COMMENT '最近一次 storage_path 键名（与 resume_screening_files.storage_path 一致）' AFTER last_file_sha256;

-- 唯一索引：同一 candidate_id 在同一 job_code 下仅一条筛查（candidate_id 为 NULL 时仍可多条，表示无法归并手机号的记录）
-- 若执行失败，请先排查并清理重复数据：
-- SELECT job_code, candidate_id, COUNT(*) c FROM resume_screenings WHERE candidate_id IS NOT NULL GROUP BY job_code, candidate_id HAVING c > 1;
CREATE UNIQUE INDEX uk_resume_screenings_job_candidate ON resume_screenings (job_code, candidate_id);
