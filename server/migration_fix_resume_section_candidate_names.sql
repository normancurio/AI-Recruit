-- 清洗简历段落/城市/字段标签被误识别为姓名的记录
-- 优先按 file_name 推断；id=919 正文姓名为武超（文件名昵称「小五」）
-- 用法: mysql -h<host> -u<user> -p ai_recruit < server/migration_fix_resume_section_candidate_names.sql
-- 或: npm run fix:candidate-names-from-filename -- --apply

USE ai_recruit;

-- 预览
SELECT id, candidate_name AS 当前姓名, file_name AS 文件名
FROM resume_screenings
WHERE id IN (919, 1052, 1064, 1065, 1072, 1074, 1077, 1078, 1079, 1087)
   OR candidate_name IN (
     '资质技能','相关技能','北京市','男刘璋','肖鹏求职意向','河北省邯郸市',
     '赵思宇学校','代应豪专业技能','总览','小五'
   )
ORDER BY id;

-- id -> 正确姓名
UPDATE resume_screenings SET candidate_name = '武超',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '武超'),
    '$.candidate_profile.name', '武超',
    '$.candidate_profile.candidate_name', '武超'
  )
WHERE id = 919 AND candidate_name = '小五';

UPDATE resume_screenings SET candidate_name = '朱振宇',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '朱振宇'),
    '$.candidate_profile.name', '朱振宇',
    '$.candidate_profile.candidate_name', '朱振宇'
  )
WHERE id = 1052 AND candidate_name = '总览';

UPDATE resume_screenings SET candidate_name = '代应豪',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '代应豪'),
    '$.candidate_profile.name', '代应豪',
    '$.candidate_profile.candidate_name', '代应豪'
  )
WHERE id = 1064 AND candidate_name = '代应豪专业技能';

UPDATE resume_screenings SET candidate_name = '赵思宇',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '赵思宇'),
    '$.candidate_profile.name', '赵思宇',
    '$.candidate_profile.candidate_name', '赵思宇'
  )
WHERE id = 1065 AND candidate_name = '赵思宇学校';

UPDATE resume_screenings SET candidate_name = '董绍威',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '董绍威'),
    '$.candidate_profile.name', '董绍威',
    '$.candidate_profile.candidate_name', '董绍威'
  )
WHERE id = 1072 AND candidate_name = '河北省邯郸市';

UPDATE resume_screenings SET candidate_name = '肖鹏',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '肖鹏'),
    '$.candidate_profile.name', '肖鹏',
    '$.candidate_profile.candidate_name', '肖鹏'
  )
WHERE id = 1074 AND candidate_name = '肖鹏求职意向';

UPDATE resume_screenings SET candidate_name = '刘文彬',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '刘文彬'),
    '$.candidate_profile.name', '刘文彬',
    '$.candidate_profile.candidate_name', '刘文彬'
  )
WHERE id = 1077 AND candidate_name = '相关技能';

UPDATE resume_screenings SET candidate_name = '韩福成',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '韩福成'),
    '$.candidate_profile.name', '韩福成',
    '$.candidate_profile.candidate_name', '韩福成'
  )
WHERE id = 1078 AND candidate_name = '北京市';

UPDATE resume_screenings SET candidate_name = '刘璋',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '刘璋'),
    '$.candidate_profile.name', '刘璋',
    '$.candidate_profile.candidate_name', '刘璋'
  )
WHERE id = 1079 AND candidate_name = '男刘璋';

UPDATE resume_screenings SET candidate_name = '高玮',
  evaluation_json = JSON_SET(
    JSON_SET(COALESCE(evaluation_json, JSON_OBJECT()), '$.candidate_name', '高玮'),
    '$.candidate_profile.name', '高玮',
    '$.candidate_profile.candidate_name', '高玮'
  )
WHERE id = 1087 AND candidate_name = '资质技能';

UPDATE resume_screening_profiles SET candidate_name = '武超', updated_at = NOW() WHERE screening_id = 919;
UPDATE resume_screening_profiles SET candidate_name = '朱振宇', updated_at = NOW() WHERE screening_id = 1052;
UPDATE resume_screening_profiles SET candidate_name = '代应豪', updated_at = NOW() WHERE screening_id = 1064;
UPDATE resume_screening_profiles SET candidate_name = '赵思宇', updated_at = NOW() WHERE screening_id = 1065;
UPDATE resume_screening_profiles SET candidate_name = '董绍威', updated_at = NOW() WHERE screening_id = 1072;
UPDATE resume_screening_profiles SET candidate_name = '肖鹏', updated_at = NOW() WHERE screening_id = 1074;
UPDATE resume_screening_profiles SET candidate_name = '刘文彬', updated_at = NOW() WHERE screening_id = 1077;
UPDATE resume_screening_profiles SET candidate_name = '韩福成', updated_at = NOW() WHERE screening_id = 1078;
UPDATE resume_screening_profiles SET candidate_name = '刘璋', updated_at = NOW() WHERE screening_id = 1079;
UPDATE resume_screening_profiles SET candidate_name = '高玮', updated_at = NOW() WHERE screening_id = 1087;
