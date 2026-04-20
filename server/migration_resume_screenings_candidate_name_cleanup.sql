-- 批量清洗 resume_screenings.candidate_name 历史异常值
-- 作用：
-- 1) 仅修正“明显不是姓名”的记录（句子片段、占位词、超长、含明显噪音）
-- 2) 优先从 evaluation_json.candidate_profile.name 回填
-- 3) 其次从 evaluation_json.candidate_name 回填
-- 4) 仍无法确定时回填为「候选人」
--
-- 用法：
--   mysql -h<host> -u<user> -p ai_recruit < server/migration_resume_screenings_candidate_name_cleanup.sql

USE ai_recruit;

UPDATE resume_screenings s
LEFT JOIN (
  SELECT
    id,
    TRIM(JSON_UNQUOTE(JSON_EXTRACT(evaluation_json, '$.candidate_profile.name'))) AS eval_profile_name,
    TRIM(JSON_UNQUOTE(JSON_EXTRACT(evaluation_json, '$.candidate_name'))) AS eval_candidate_name
  FROM resume_screenings
) e ON e.id = s.id
SET s.candidate_name = CASE
  WHEN
    e.eval_profile_name IS NOT NULL
    AND e.eval_profile_name <> ''
    AND LOWER(e.eval_profile_name) NOT IN ('n/a', 'na', 'null', 'none')
    AND e.eval_profile_name NOT IN ('未知', '无', '未提供', '不详', '候选人', '未识别', '暂无', '姓名', '名字')
    AND CHAR_LENGTH(e.eval_profile_name) BETWEEN 2 AND 30
    AND e.eval_profile_name NOT REGEXP '[，。；;：:！？!?、]'
    AND e.eval_profile_name NOT REGEXP '[0-9]{4,}'
    AND e.eval_profile_name NOT REGEXP '[@#/\\\\]'
  THEN e.eval_profile_name
  WHEN
    e.eval_candidate_name IS NOT NULL
    AND e.eval_candidate_name <> ''
    AND LOWER(e.eval_candidate_name) NOT IN ('n/a', 'na', 'null', 'none')
    AND e.eval_candidate_name NOT IN ('未知', '无', '未提供', '不详', '候选人', '未识别', '暂无', '姓名', '名字')
    AND CHAR_LENGTH(e.eval_candidate_name) BETWEEN 2 AND 30
    AND e.eval_candidate_name NOT REGEXP '[，。；;：:！？!?、]'
    AND e.eval_candidate_name NOT REGEXP '[0-9]{4,}'
    AND e.eval_candidate_name NOT REGEXP '[@#/\\\\]'
  THEN e.eval_candidate_name
  ELSE '候选人'
END
WHERE
  s.candidate_name IS NULL
  OR TRIM(s.candidate_name) = ''
  OR LOWER(TRIM(s.candidate_name)) IN ('n/a', 'na', 'null', 'none')
  OR TRIM(s.candidate_name) IN ('未知', '无', '未提供', '不详', '候选人', '未识别', '暂无', '姓名', '名字')
  OR CHAR_LENGTH(TRIM(s.candidate_name)) < 2
  OR CHAR_LENGTH(TRIM(s.candidate_name)) > 30
  OR TRIM(s.candidate_name) REGEXP '[，。；;：:！？!?、]'
  OR TRIM(s.candidate_name) REGEXP '[0-9]{4,}'
  OR TRIM(s.candidate_name) REGEXP '[@#/\\\\]';

