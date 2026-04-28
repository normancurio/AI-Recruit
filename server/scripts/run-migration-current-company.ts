/**
 * 为 resume_screening_profiles 增加 current_company（与 server/index.ts 使用相同 MYSQL_* 环境变量）。
 * 用法：在项目根目录执行  npm run migrate:current-company
 * 依赖：根目录 .env.local 或 .env 中已配置远程库 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE 等。
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(repoRoot, '.env.local') })
dotenv.config({ path: path.join(repoRoot, '.env') })

async function main(): Promise<void> {
  const host = process.env.MYSQL_HOST || '127.0.0.1'
  const port = Number(process.env.MYSQL_PORT || 3306)
  const user = process.env.MYSQL_USER || 'root'
  const password = process.env.MYSQL_PASSWORD || ''
  const database = process.env.MYSQL_DATABASE || 'ai_recruit'

  console.log(`[migrate] Connecting ${user}@${host}:${port}/${database} …`)

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database
  })

  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'resume_screening_profiles' AND COLUMN_NAME = 'current_company'`,
      [database]
    )
    const has = Number((rows[0] as { c: number }).c) > 0
    if (has) {
      console.log('[migrate] Column current_company already exists — nothing to do.')
      return
    }
    await conn.execute(
      `ALTER TABLE resume_screening_profiles ADD COLUMN current_company VARCHAR(255) NULL AFTER current_address`
    )
    console.log('[migrate] Added column current_company to resume_screening_profiles.')
  } finally {
    await conn.end()
  }
}

main().catch((e: unknown) => {
  console.error('[migrate] Failed:', e)
  process.exit(1)
})
