-- 预览：候选人姓名被误识别为 Java/Python/测试 等技术词或占位词
-- 不会修改数据。确认后请用脚本按 file_name 批量修正（与线上一致逻辑）：
--   npm run fix:candidate-names-from-filename
--   npm run fix:candidate-names-from-filename -- --apply
--
-- 用法：
--   mysql -h<host> -u<user> -p ai_recruit < server/migration_fix_tech_word_candidate_names_preview.sql

USE ai_recruit;

SELECT
  id,
  candidate_name AS 当前姓名,
  file_name AS 文件名,
  job_code AS 岗位,
  created_at AS 上传时间
FROM resume_screenings
WHERE
  file_name IS NOT NULL
  AND TRIM(file_name) <> ''
  AND (
    LOWER(TRIM(candidate_name)) IN (
      'java', 'python', 'javascript', 'typescript', 'go', 'golang', 'rust', 'kotlin', 'swift',
      'android', 'ios', 'react', 'vue', 'angular', 'spring', 'springboot', 'nodejs', 'node',
      'web', 'labview', 'mes', 'devops', 'backend', 'frontend', 'fullstack', 'developer',
      'engineer', 'architect', 'senior', 'junior', 'test', 'testing', 'qa', 'pm', 'ba',
      'php', 'ruby', 'scala', 'dev'
    )
    OR TRIM(candidate_name) IN ('测试', '申朴', '简历', '加水印', '候选人', '未知')
    OR TRIM(candidate_name) REGEXP '^[A-Za-z]{2,16}$'
  )
ORDER BY id DESC;

-- 单条手工修正示例（把 id、姓名 换成实际值）：
-- UPDATE resume_screenings SET candidate_name = '赵远成' WHERE id = 123;
-- UPDATE resume_screening_profiles SET candidate_name = '赵远成' WHERE screening_id = 123;
-- UPDATE resume_screenings
-- SET evaluation_json = JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '赵远成')
-- WHERE id = 123;
