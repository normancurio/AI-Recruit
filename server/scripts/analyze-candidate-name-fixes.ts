import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import { guessCandidateNameFromFilename, isFilenameEnglishNoiseToken } from '../resumeFilenameName.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
dotenv.config({ path: path.join(repoRoot, '.env.local') })

const PLACEHOLDER = new Set([
  '未知', '无', '未提供', '不详', '候选人', '未识别', '暂无', '姓名', '名字',
  '个人简历', '求职简历', '申朴简历', '测试简历'
])
const JOB_OR_CITY =
  /^(需求分析|实施交付|实施|数据开发|前端|后端|测试|Java|Python|郑州|北京|上海|杭州|深圳|苏州|广州|成都|武汉|南京|重庆|太仓|个人优势|年龄|前端框架与生态)$/
const GUESS_BAD =
  /^(郑州|北京|上海|杭州|深圳|苏州|广州|成都|武汉|南京|重庆|太仓|需求分析|实施|数据开发|实施交付|前端|后端|测试)$/

function shouldFixCurrentName(current: string): boolean {
  const c = String(current || '').trim()
  if (!c) return true
  if (PLACEHOLDER.has(c)) return true
  if (isFilenameEnglishNoiseToken(c)) return true
  if (/^(测试|申朴|简历|加水印)$/.test(c)) return true
  if (/^[A-Za-z]{2,16}$/.test(c)) return true
  return false
}

function badNameKind(c: string): string {
  c = String(c || '').trim()
  if (shouldFixCurrentName(c)) return 'tech/placeholder'
  if (JOB_OR_CITY.test(c)) return 'job_or_city'
  if (/[\u4e00-\u9fa5]{2,}[年民族优势框架]/.test(c)) return 'resume_fragment'
  if (/^[\u4e00-\u9fa5]{2,3}[男女]$/.test(c)) return 'gender_suffix'
  return ''
}

async function main(): Promise<void> {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'ai_recruit'
  })

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, candidate_name, file_name FROM resume_screenings
     WHERE file_name IS NOT NULL AND TRIM(file_name) <> '' ORDER BY id`
  )

  const safe: Array<{ id: number; from: string; to: string; fileName: string; kind: string }> = []
  const risky: typeof safe = []
  const gender: typeof safe = []

  for (const row of rows) {
    const current = String(row.candidate_name || '').trim()
    const fileName = String(row.file_name || '').trim()
    const guessed = guessCandidateNameFromFilename(fileName)
    if (!guessed || guessed === current) continue
    const kind = badNameKind(current)
    if (!kind) continue
    const item = { id: Number(row.id), from: current, to: guessed, fileName, kind }
    if (GUESS_BAD.test(guessed)) risky.push(item)
    else if (kind === 'gender_suffix') gender.push(item)
    else safe.push(item)
  }

  console.log('=== 默认脚本规则：0 条（已修完）===')
  console.log('=== 额外明显错名 + 文件名可推断真名（建议再改）===')
  console.log(`共 ${safe.length} 条\n`)
  for (const p of safe) console.log(`  id=${p.id}  ${p.from} → ${p.to}  （${p.fileName}）`)

  console.log(`\n=== 错名但脚本会猜成城市/岗位（需先改解析逻辑）===`)
  console.log(`共 ${risky.length} 条\n`)
  for (const p of risky.slice(0, 20)) console.log(`  id=${p.id}  ${p.from} → ${p.to}  （${p.fileName}）`)
  if (risky.length > 20) console.log(`  … 另有 ${risky.length - 20} 条`)

  console.log(`\n=== 仅去掉「男/女」后缀（可不处理）===`)
  console.log(`共 ${gender.length} 条\n`)
  for (const p of gender) console.log(`  id=${p.id}  ${p.from} → ${p.to}`)

  await conn.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
