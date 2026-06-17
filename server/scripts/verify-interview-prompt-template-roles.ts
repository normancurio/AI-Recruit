/**
 * Verify default AI interview prompt template is visible to recruiting roles.
 * Run after deploying API + migration_interview_prompt_template_visible_roles.sql.
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import {
  canViewPromptTemplate,
  normalizePromptRoleList
} from '../interviewPromptTemplateRoles.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(repoRoot, '.env.local') })
dotenv.config({ path: path.join(repoRoot, '.env') })

const BUILTIN_TEMPLATE_NAME = '申朴面试官AI'

async function main(): Promise<void> {
  const database = process.env.MYSQL_DATABASE || 'ai_recruit'
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database
  })

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, name, visible_roles, editable_roles
       FROM ai_interview_prompt_templates
       WHERE id = 1 OR name = ?
       ORDER BY id ASC
       LIMIT 1`,
      [BUILTIN_TEMPLATE_NAME]
    )
    const row = rows[0]
    if (!row) throw new Error(`Missing default template "${BUILTIN_TEMPLATE_NAME}"`)

    const visibleRoles = normalizePromptRoleList(row.visible_roles, [])
    const editableRoles = normalizePromptRoleList(row.editable_roles, [])
    const recruiterActor = { uiRole: 'recruiter', roleNames: ['招聘专员'] }
    const recruiterCanView = canViewPromptTemplate(recruiterActor, { visibleRoles })

    const report = {
      database,
      templateId: String(row.id || ''),
      templateName: String(row.name || ''),
      visibleRoles,
      editableRoles,
      recruiterCanView
    }
    console.log(JSON.stringify(report, null, 2))

    if (!recruiterCanView) {
      throw new Error('Default template is still not visible to 招聘专员 / recruiter')
    }
    if (!visibleRoles.includes('recruiter')) {
      throw new Error('visible_roles missing canonical recruiter after normalization')
    }
  } finally {
    await conn.end()
  }
}

main().catch((e: unknown) => {
  console.error('[verify-interview-prompt-template-roles] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
