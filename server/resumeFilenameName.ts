const FILENAME_NAME_STOP_WORDS = new Set([
  '申朴',
  '简历',
  '个人简历',
  '求职简历',
  '候选人',
  '保单',
  '可出差',
  '加水印',
  '北京',
  '上海',
  '深圳',
  '苏州',
  '杭州',
  '广州',
  '成都',
  '武汉',
  '南京',
  '太仓',
  '重庆'
])

const FILENAME_ROLE_WORD_RE =
  /^(java|python|javascript|typescript|go|golang|rust|kotlin|swift|android|ios|mes|labview|web|前端|后端|全栈|测试|太仓测试|测试台架|产品|产品经理|项目经理|经理|运维|大数据|数据|建模|数据建模|算法|视觉算法|采购|采购专员|市场|市场专员|开发|开发工程师|工程师|架构师|资深|高级|中级|初级|技术|研发|spring|springboot|nodejs|react|vue|angular|devops|backend|frontend|fullstack|c\+\+|c#|php|ruby|scala)$/i

const FILENAME_EN_NOISE_RE =
  /^(java|python|javascript|typescript|go|golang|rust|kotlin|swift|android|ios|react|vue|angular|spring|springboot|nodejs|node|web|labview|mes|devops|backend|frontend|fullstack|developer|engineer|architect|senior|junior|test|testing|qa|pm|ba|ui|ux|hr|bd|c\+\+|c#|php|ruby|scala|dev)$/i

export function isFilenameEnglishNoiseToken(raw: string): boolean {
  const t = String(raw || '').trim()
  if (!t) return true
  if (FILENAME_EN_NOISE_RE.test(t)) return true
  if (FILENAME_ROLE_WORD_RE.test(t)) return true
  return false
}

function normalizeFilenameBase(filename: string): string {
  let name = String(filename || '').trim()
  try {
    name = decodeURIComponent(name)
  } catch {
    /* ignore */
  }
  return name.replace(/^.*[/\\]/, '').trim()
}

function normalizeChineseNameToken(raw: string): string {
  let s = String(raw || '')
    .replace(/[^\u4e00-\u9fa5]/g, '')
    .trim()
  if (s.length >= 3 && /[男女]$/.test(s)) {
    const withoutGender = s.slice(0, -1)
    if (withoutGender.length >= 2) s = withoutGender
  }
  return s
}

function sanitizeEnglishFilenameName(raw: string): string {
  const n = String(raw || '').trim()
  if (!n || n.length < 2 || n.length > 30) return ''
  if (isFilenameEnglishNoiseToken(n)) return ''
  if (/^[A-Za-z][A-Za-z\s.'-]{1,29}$/.test(n)) return n
  return ''
}

function isPlausibleFilenameCandidateName(raw: string): boolean {
  const s = normalizeChineseNameToken(raw)
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(s)) return false
  if (FILENAME_NAME_STOP_WORDS.has(s)) return false
  if (FILENAME_ROLE_WORD_RE.test(s)) return false
  return true
}

/** 从上传文件名推断中文/英文候选人姓名（优先中文片段，忽略 Java/Python 等技术前缀） */
export function guessCandidateNameFromFilename(filename: string): string {
  const original = normalizeFilenameBase(filename)
  const base = original
    .replace(/\.[^.]+$/i, '')
    .replace(/[（(][^()（）]*[）)]/g, ' ')
    .replace(/[【\[][^】\]]*[】\]]/g, ' ')
    .replace(/[_－—–]/g, '-')
    .replace(/pdf/gi, ' ')
    .replace(/加水印/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const yearName = base.match(/(?:^|[\s\-】])([\u4e00-\u9fa5]{2,4})\s*(?:10年以上|\d+\s*年)/)
  if (yearName?.[1] && isPlausibleFilenameCandidateName(yearName[1])) {
    return normalizeChineseNameToken(yearName[1])
  }

  const resumeLabelName = base.match(/([\u4e00-\u9fa5]{2,4})\s*的?\s*(?:个人)?简历/)
  if (resumeLabelName?.[1] && isPlausibleFilenameCandidateName(resumeLabelName[1])) {
    return normalizeChineseNameToken(resumeLabelName[1])
  }

  const parts = base
    .split(/[-\s]+/)
    .map((p) => normalizeChineseNameToken(p))
    .filter(Boolean)

  const candidates: string[] = []
  for (let i = parts.length - 1; i >= 0; i -= 1) candidates.push(parts[i]!)
  for (let i = 0; i < parts.length; i += 1) {
    if (FILENAME_NAME_STOP_WORDS.has(parts[i]!) && i + 1 < parts.length) candidates.push(parts[i + 1]!)
  }
  if (parts[0] && parts[0] !== '申朴') candidates.push(parts[0])

  for (const c of candidates) {
    if (isPlausibleFilenameCandidateName(c)) return normalizeChineseNameToken(c)
  }

  const enLead = base.match(/^([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+){0,2})(?:\s|[-_.]|$)/)
  if (enLead?.[1]) {
    const en = sanitizeEnglishFilenameName(enLead[1])
    if (en) return en
  }
  return ''
}
