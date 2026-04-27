-- 按规范化手机号归并「同人」主档，并在 resume_screenings 上挂 candidate_id
-- mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_candidates_and_screening_fk.sql

USE ai_recruit;

CREATE TABLE IF NOT EXISTS resume_candidates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone VARCHAR(32) NOT NULL COMMENT 'normalizeCnMobile 后的 11 位大陆手机号，唯一',
  display_name VARCHAR(128) NULL COMMENT '最近一条筛查写入的展示姓名',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_resume_candidates_phone (phone),
  KEY idx_resume_candidates_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历同人主档（按手机号）';

-- 若列已存在可忽略报错后手工校验
ALTER TABLE resume_screenings
  ADD COLUMN candidate_id BIGINT UNSIGNED NULL COMMENT 'resume_candidates.id，按手机号同人' AFTER candidate_phone,
  ADD KEY idx_resume_screenings_candidate_id (candidate_id);

-- 可选外键（部分环境 ALTER 顺序敏感，如需可取消注释执行）
-- ALTER TABLE resume_screenings
--   ADD CONSTRAINT fk_resume_screenings_resume_candidate
--   FOREIGN KEY (candidate_id) REFERENCES resume_candidates(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 历史数据回填思路（按需手写/脚本执行；勿与未迁移库混跑）
-- 1) 对 resume_screenings.candidate_phone 能规范成 11 位手机号的行，INSERT IGNORE 或
--    INSERT .. ON DUPLICATE KEY 写入 resume_candidates(phone, display_name)。
-- 2) UPDATE resume_screenings s INNER JOIN resume_candidates c ON c.phone = <规范化后的 s.candidate_phone>
--    SET s.candidate_id = c.id WHERE s.candidate_id IS NULL;
-- 规范化规则须与 server/index.ts 中 normalizeCnMobile 一致（仅大陆 11 位等）。
