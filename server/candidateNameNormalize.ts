const RESUME_SECTION_AS_NAME =
  /^(资质技能|相关技能|专业技能|技能特长|个人优势|求职意向|总览|学校|姓名|性别|年龄|工作经历|项目经验|教育经历)$/

const CITY_AS_NAME =
  /^(北京市|上海市|天津市|重庆市|河北省[\u4e00-\u9fa5]{1,8}|江苏省[\u4e00-\u9fa5]{1,8}|浙江省[\u4e00-\u9fa5]{1,8}|广东省[\u4e00-\u9fa5]{1,8}|四川省[\u4e00-\u9fa5]{1,8}|[^\s]{2,6}市[^\s]{0,6}|[^\s]{2,8}省[^\s]{0,8})$/

/** 判断当前姓名是否像简历段落/城市/字段标签误识别 */
export function isResumeSectionMisidentifiedName(raw: string): boolean {
  const s = String(raw || '').trim()
  if (!s) return false
  if (RESUME_SECTION_AS_NAME.test(s)) return true
  if (CITY_AS_NAME.test(s)) return true
  if (/技能/.test(s) && s.length <= 12) return true
  if (/求职意向/.test(s)) return true
  if (/学校$/.test(s) && s.length <= 8) return true
  if (/^男[\u4e00-\u9fa5]{2,4}$/.test(s)) return true
  if (/^女[\u4e00-\u9fa5]{2,4}$/.test(s)) return true
  if (/^[\u4e00-\u9fa5]{2,4}性别$/.test(s)) return true
  if (/^[\u4e00-\u9fa5]{2,4}(?:男|女)(?:汉|族|汉族)?$/.test(s)) return true
  return false
}

/** 去掉中文姓名误带的性别/民族/字段词/段落标签 */
export function stripChinesePersonNameSuffix(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return s

  s = s
    .replace(/^男(?=[\u4e00-\u9fa5]{2,4}$)/, '')
    .replace(/^女(?=[\u4e00-\u9fa5]{2,4}$)/, '')
    .replace(/(专业技能|相关技能|资质技能|求职意向|学校)$/, '')
    .replace(/性别$/, '')

  const genderEthnic = s.match(/^([\u4e00-\u9fa5]{2,4})(?:男|女)(?:汉|族|汉族)?$/)
  if (genderEthnic?.[1]) return genderEthnic[1]

  if (/^[\u4e00-\u9fa5]{2,4}[男女]$/.test(s)) {
    return s.slice(0, -1)
  }

  return s
}
