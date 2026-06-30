import fs from 'fs'
import { execFileSync } from 'child_process'

const pdf = process.argv[2] || '/app/storage/resumes/1780481729683-4372b89a-d6c2-4d2e-96ba-a40eda21fafe.pdf'
const key = process.env.DASHSCOPE_API_KEY
const model = process.env.QWEN_RESUME_OCR_MODEL || 'qwen3.5-ocr'
const base = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')

execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-png', '-r', '160', pdf, '/tmp/ocr-test/page'])
const url = `data:image/png;base64,${fs.readFileSync('/tmp/ocr-test/page-1.png').toString('base64')}`

async function run(label, sys, user) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: [{ type: 'text', text: user }, { type: 'image_url', image_url: { url } }] }
      ]
    })
  })
  const j = await res.json()
  const c = j.choices?.[0]?.message?.content || ''
  let rawLen = 0
  try {
    const cleaned = c.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
    rawLen = JSON.parse(cleaned).rawText?.length || 0
  } catch {
    rawLen = c.length
  }
  console.log(label, 'contentLen', c.length, 'rawTextLen', rawLen, 'finish', j.choices?.[0]?.finish_reason)
}

await run('server', '你是简历 OCR 转写器。只输出一个合法 JSON 对象，含 candidateName,candidatePhone,email,gender,rawText；rawText 必须逐字转写全部可见正文（工作经历、项目、教育等），不要只输出姓名。', '共 1 张简历页面。请按页顺序逐字转写全部可见文字到 rawText（不要总结、不要省略）。同时提取 candidateName,candidatePhone,email,gender；姓名只保留人名本身。无法识别用空字符串。只输出 JSON。')
await run('plain', '请逐字转写图片中的全部可见文字，保留换行，不要总结。', '转写简历全文')
await run('jsonSimple', '只输出 JSON：candidateName,candidatePhone,email,gender,rawText。rawText 为全文逐字转写，不要省略。', '转写这张简历')
