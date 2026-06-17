/** 工作经历 / 项目经历等章节标题（用于智能截断时优先保留） */
const WORK_SECTION_MARKERS = [
  '工作经历',
  '工作经验',
  '任职履历',
  '职业履历',
  '工作履历',
  '从业经历',
  '工作背景',
  '项目经历',
  '项目经验',
  '交付经历',
  '实施经历'
]

function collapseSpaces(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function findEarliestSectionIndex(text: string): number {
  let idx = -1
  for (const marker of WORK_SECTION_MARKERS) {
    const i = text.indexOf(marker)
    if (i >= 0 && (idx < 0 || i < idx)) idx = i
  }
  return idx
}

/**
 * 为 AI 评估裁剪简历正文：优先保留头部基本信息 + 工作/项目章节 + 尾部，避免长简历只截前 N 字丢经历。
 */
export function clipResumeTextForAi(raw: string, maxChars: number): string {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  const max = Math.max(2000, Math.floor(maxChars))
  const norm = collapseSpaces(text)
  if (norm.length <= max) return norm

  const headBudget = Math.min(3200, Math.floor(max * 0.28))
  const tailBudget = Math.min(2200, Math.floor(max * 0.16))
  const coreBudget = Math.max(1200, max - headBudget - tailBudget - 3)

  const sectionIdx = findEarliestSectionIndex(text)
  const head = collapseSpaces(text.slice(0, headBudget))
  let core = ''
  if (sectionIdx >= 0) {
    core = collapseSpaces(text.slice(sectionIdx)).slice(0, coreBudget)
  } else {
    core = norm.slice(headBudget, headBudget + coreBudget)
  }
  const tail = norm.slice(-tailBudget)

  const parts = [head, core, tail].filter((p) => p.length > 0)
  let out = parts.join(' … ')
  if (out.length > max) out = out.slice(0, max)
  return out
}
