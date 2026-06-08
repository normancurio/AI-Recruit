/**
 * 本地 OCR 冒烟：扫描 PDF / 图片简历识别链路
 * 用法：node scripts/test-resume-ocr-local.mjs [png|pdf路径，可选]
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })

const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
const model = process.env.QWEN_RESUME_OCR_MODEL?.trim() || 'qwen-vl-ocr-latest'
const baseUrl = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')

async function ensureTestPng(outPath) {
  const py = `
import sys
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit(2)
w, h = 860, 520
img = Image.new('RGB', (w, h), 'white')
draw = ImageDraw.Draw(img)
font = None
for fp in ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc', '/Library/Fonts/Arial Unicode.ttf']:
    try:
        font = ImageFont.truetype(fp, 28)
        break
    except Exception:
        pass
if font is None:
    font = ImageFont.load_default()
lines = ['个人简历', '姓名：张三', '手机：13800138000', '邮箱：zhangsan@example.com', '工作经历：', '某某科技有限公司 高级Java工程师 2020-2024', '负责后端系统开发与架构设计']
y = 36
for line in lines:
    draw.text((40, y), line, fill='black', font=font)
    y += 52
img.save(sys.argv[1])
print('ok')
`
  const r = await execFileAsync('python3', ['-c', py, outPath], { timeout: 15000 })
  if (!String(r.stdout).includes('ok')) throw new Error('生成测试 PNG 失败')
}

async function pngToDataUri(pngPath) {
  const buf = fs.readFileSync(pngPath)
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function pdfToDataUris(pdfPath, maxPages = 3) {
  const dir = fs.mkdtempSync(path.join('/tmp', 'resume-ocr-test-'))
  const pdfCopy = path.join(dir, 'input.pdf')
  const outPrefix = path.join(dir, 'page')
  fs.copyFileSync(pdfPath, pdfCopy)
  try {
    await execFileAsync('pdftoppm', ['-f', '1', '-l', String(maxPages), '-png', '-r', '160', pdfCopy, outPrefix], {
      timeout: 25000
    })
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => {
        const img = fs.readFileSync(path.join(dir, f))
        return `data:image/png;base64,${img.toString('base64')}`
      })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function runOcr(imageUrls) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你是简历首页 OCR 信息抽取器。只输出 JSON：candidateName,candidatePhone,email,gender,rawText'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请从这张简历提取信息，只输出 JSON。' },
            ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(60000)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  return data?.choices?.[0]?.message?.content
}

async function main() {
  console.log('[ocr-test] model =', model)
  if (!apiKey) {
    console.error('[ocr-test] 缺少 DASHSCOPE_API_KEY')
    process.exit(1)
  }

  let pdftoppm = 'missing'
  try {
    const w = await execFileAsync('which', ['pdftoppm'])
    pdftoppm = String(w.stdout).trim()
  } catch {
    /* ignore */
  }
  console.log('[ocr-test] pdftoppm =', pdftoppm)

  const arg = process.argv[2]
  let imageUrls = []
  if (arg && fs.existsSync(arg)) {
    const ext = path.extname(arg).toLowerCase()
    if (ext === '.pdf') {
      if (pdftoppm === 'missing') {
        console.error('[ocr-test] 扫描 PDF 需要 pdftoppm，请先 brew install poppler')
        process.exit(1)
      }
      imageUrls = await pdfToDataUris(arg)
      console.log('[ocr-test] PDF 转图', imageUrls.length, '页')
    } else {
      imageUrls = [await pngToDataUri(arg)]
    }
  } else {
    const png = path.join('/tmp', 'ai-recruit-ocr-test.png')
    try {
      await ensureTestPng(png)
    } catch (e) {
      if (e?.code === 2 || String(e?.stderr || '').includes('PIL')) {
        console.error('[ocr-test] 需要 Pillow 生成测试图：pip3 install pillow')
        process.exit(1)
      }
      throw e
    }
    imageUrls = [await pngToDataUri(png)]
    console.log('[ocr-test] 使用生成的测试 PNG:', png)
  }

  if (!imageUrls.length) {
    console.error('[ocr-test] 无可用图片')
    process.exit(1)
  }

  const raw = await runOcr(imageUrls)
  console.log('[ocr-test] 模型返回:')
  console.log(raw)
  const parsed = JSON.parse(String(raw || '{}').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, ''))
  const name = parsed.candidateName || parsed.name || ''
  const phone = parsed.candidatePhone || parsed.phone || ''
  if (name || phone || parsed.rawText) {
    console.log('[ocr-test] ✓ OCR 成功', { name, phone, rawLen: String(parsed.rawText || '').length })
  } else {
    console.error('[ocr-test] ✗ 未识别到有效字段')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[ocr-test] 失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
