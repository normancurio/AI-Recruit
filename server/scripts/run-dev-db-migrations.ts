/**
 * Run the dev-branch schema migrations against the configured MySQL databases.
 *
 * Safety: this refuses non-local hosts by default. Set ALLOW_REMOTE_DB_MIGRATION=1
 * only when you intentionally want to run these migrations against a remote DB.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(repoRoot, '.env.local') })
dotenv.config({ path: path.join(repoRoot, '.env') })

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

const businessMigrations = [
  'server/migration_interview_followup_configs.sql',
  'server/migration_ai_interview_prompt_templates.sql',
  'server/migration_interview_invitations_prompt_template_id.sql',
  'server/migration_resume_screening_shenpu_resumes.sql',
  'server/migration_projects_shenpu_resume_template.sql'
]

const adminMigrations = [
  'server/migration_depts_sort_order.sql',
  'server/migration_admin_ai_interviewer_role_menu.sql'
]

function dbConfig(database: string): mysql.ConnectionOptions {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database,
    multipleStatements: true
  }
}

function assertSafeTarget(): void {
  const host = String(process.env.MYSQL_HOST || '127.0.0.1').trim()
  if (process.env.ALLOW_REMOTE_DB_MIGRATION === '1') return
  if (LOCAL_HOSTS.has(host)) return
  throw new Error(
    `Refusing to run migrations on non-local MYSQL_HOST=${host}. ` +
      'Use a local .env.local target, or set ALLOW_REMOTE_DB_MIGRATION=1 intentionally.'
  )
}

async function runSqlFile(database: string, relPath: string): Promise<void> {
  const abs = path.join(repoRoot, relPath)
  const sql = fs.readFileSync(abs, 'utf8')
  const conn = await mysql.createConnection(dbConfig(database))
  try {
    console.log(`[migrate] ${database} <= ${relPath}`)
    await conn.query(sql)
  } finally {
    await conn.end()
  }
}

async function main(): Promise<void> {
  assertSafeTarget()
  const businessDb = process.env.MYSQL_DATABASE || 'ai_recruit'
  const adminDb = process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin'
  console.log(`[migrate] target ${process.env.MYSQL_USER || 'root'}@${process.env.MYSQL_HOST || '127.0.0.1'}:${process.env.MYSQL_PORT || 3306}`)
  for (const file of businessMigrations) await runSqlFile(businessDb, file)
  for (const file of adminMigrations) await runSqlFile(adminDb, file)
  console.log('[migrate] done')
}

main().catch((e: unknown) => {
  console.error('[migrate] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
