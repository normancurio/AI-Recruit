/**
 * 按 file_name 重新识别候选人姓名，修正历史误识别（如 Java、Python、测试）。
 *
 * 用法（项目根目录，读取 .env.local 的 MYSQL_*）：
 *   npm run fix:candidate-names-from-filename              # 仅预览，不写库
 *   npm run fix:candidate-names-from-filename -- --apply    # 确认后写入
 *   npm run fix:candidate-names-from-filename -- --apply --all  # 凡与文件名推断不一致都改（慎用）
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import {
  guessCandidateNameFromFilename,
  isFilenameEnglishNoiseToken
} from '../resumeFilenameName.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(repoRoot, '.env.local') })
dotenv.config({ path: path.join(repoRoot, '.env') })

const PLACEHOLDER_NAMES = new Set([
  '未知',
  '无',
  '未提供',
  '不详',
  '候选人',
  '未识别',
  '暂无',
  '姓名',
  '名字',
  '个人简历',
  '求职简历',
  '申朴简历',
  '测试简历'
])

const JOB_OR_CITY_AS_NAME =
  /^(需求分析|实施交付|实施|数据开发|前端|后端|测试|Java|Python|郑州|北京|上海|杭州|深圳|苏州|广州|成都|武汉|南京|重庆|太仓|个人优势|年龄|前端框架与生态)$/

/** 推断结果若是城市/岗位词，默认跳过（避免 侯海洋 被改成 郑州） */
const UNSAFE_GUESSED_NAME =
  /^(郑州|北京|上海|杭州|深圳|苏州|广州|成都|武汉|南京|重庆|太仓|需求分析|实施|数据开发|实施交付|前端|后端|测试)$/

function shouldFixCurrentName(current: string, fixAll: boolean): boolean {
  const c = String(current || '').trim()
  if (fixAll) return true
  if (!c) return true
  if (PLACEHOLDER_NAMES.has(c)) return true
  if (isFilenameEnglishNoiseToken(c)) return true
  if (/^(测试|申朴|简历|加水印)$/.test(c)) return true
  if (/^[A-Za-z]{2,16}$/.test(c)) return true
  if (JOB_OR_CITY_AS_NAME.test(c)) return true
  if (/[\u4e00-\u9fa5]{2,}[年民族优势框架]/.test(c)) return true
  if (/^[\u4e00-\u9fa5]{2,3}[男女]$/.test(c)) return true
  return false
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const fixAll = process.argv.includes('--all')

  const host = process.env.MYSQL_HOST || '127.0.0.1'
  const port = Number(process.env.MYSQL_PORT || 3306)
  const user = process.env.MYSQL_USER || 'root'
  const password = process.env.MYSQL_PASSWORD || ''
  const database = process.env.MYSQL_DATABASE || 'ai_recruit'

  console.log(`[fix-name] 连接 ${user}@${host}:${port}/${database} …`)
  console.log(`[fix-name] 模式：${apply ? '写入' : '预览（加 --apply 才写库）'}${fixAll ? '，--all' : ''}`)

  const conn = await mysql.createConnection({ host, port, user, password, database })

  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, candidate_name, file_name, evaluation_json
       FROM resume_screenings
       WHERE file_name IS NOT NULL AND TRIM(file_name) <> ''
       ORDER BY id ASC`
    )

    const planned: Array<{
      id: number
      from: string
      to: string
      fileName: string
    }> = []

    for (const row of rows) {
      const id = Number(row.id)
      const current = String(row.candidate_name || '').trim()
      const fileName = String(row.file_name || '').trim()
      const guessed = guessCandidateNameFromFilename(fileName)
      if (!guessed) continue
      if (guessed === current) continue
      if (!shouldFixCurrentName(current, fixAll)) continue
      if (!fixAll && UNSAFE_GUESSED_NAME.test(guessed)) continue
      planned.push({ id, from: current || '（空）', to: guessed, fileName })
    }

    if (!planned.length) {
      console.log('[fix-name] 没有需要修正的记录。')
      return
    }

    console.log(`[fix-name] 待修正 ${planned.length} 条：\n`)
    for (const p of planned.slice(0, 50)) {
      console.log(`  id=${p.id}  ${p.from} → ${p.to}  （${p.fileName}）`)
    }
    if (planned.length > 50) {
      console.log(`  … 另有 ${planned.length - 50} 条未列出`)
    }

    if (!apply) {
      console.log('\n[fix-name] 预览结束。确认无误后执行：npm run fix:candidate-names-from-filename -- --apply')
      return
    }

    let updated = 0
    for (const p of planned) {
      const [srows] = await conn.query<RowDataPacket[]>(
        'SELECT evaluation_json FROM resume_screenings WHERE id = ? LIMIT 1',
        [p.id]
      )
      let evalJson: unknown = srows[0]?.evaluation_json
      if (typeof evalJson === 'string' && evalJson.trim()) {
        try {
          evalJson = JSON.parse(evalJson)
        } catch {
          evalJson = {}
        }
      }
      if (!evalJson || typeof evalJson !== 'object' || Array.isArray(evalJson)) {
        evalJson = {}
      }
      const obj = { ...(evalJson as Record<string, unknown>) }
      obj.candidate_name = p.to
      const profile =
        obj.candidate_profile && typeof obj.candidate_profile === 'object' && !Array.isArray(obj.candidate_profile)
          ? { ...(obj.candidate_profile as Record<string, unknown>) }
          : {}
      profile.name = p.to
      profile.candidate_name = p.to
      obj.candidate_profile = profile

      await conn.execute('UPDATE resume_screenings SET candidate_name = ?, evaluation_json = ? WHERE id = ?', [
        p.to,
        JSON.stringify(obj),
        p.id
      ])

      await conn.execute(
        `UPDATE resume_screening_profiles SET candidate_name = ?, updated_at = NOW() WHERE screening_id = ?`,
        [p.to, p.id]
      ).catch(() => {
        /* 表或行可能不存在 */
      })

      updated += 1
    }

    console.log(`\n[fix-name] 已更新 ${updated} 条。申朴 Word/PDF 需在后台对该记录重新生成。`)
  } finally {
    await conn.end()
  }
}

main().catch((e: unknown) => {
  console.error('[fix-name] 失败:', e)
  process.exit(1)
})
