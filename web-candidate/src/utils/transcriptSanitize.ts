const NOISE_EN_FRAG = /^(this|shh|ah|um|uh|hmm|shit)\.?$/i

/** 清洗 ASR 元数据、英文噪声碎片（对齐面试中文作答场景） */
export function sanitizeTranscriptText(raw: string): string {
  let t = String(raw || '').trim()
  if (!t) return ''

  const asrMatch = t.match(/<asr_text>\s*([\s\S]*?)\s*<\/asr_text>/i)
  if (asrMatch) t = asrMatch[1].trim()

  t = t
    .replace(/<\/?asr_text>/gi, '')
    .replace(/\b(language|emotion)\s*[:：]\s*[^\n.]*/gi, '')
    .replace(/\b(language|emotion)\s+\w+/gi, '')

  const parts = t
    .split(/[\n]+/)
    .flatMap((line) => line.split(/(?<=[。.!?])\s*/))
    .map((s) => s.trim())
    .filter(Boolean)

  const kept = parts.filter((p) => {
    if (NOISE_EN_FRAG.test(p)) return false
    if (/^(language|emotion)\b/i.test(p)) return false
    if (p.length <= 4 && /^[a-z\s.]+$/i.test(p)) return false
    return true
  })

  t = kept.join('').replace(/\s+/g, '')

  if (/^(language|emotion)/i.test(t)) return ''

  const chinese = (t.match(/[\u4e00-\u9fa5]/g) || []).length
  if (chinese === 0 && t.length < 6) return ''

  return t.trim()
}
