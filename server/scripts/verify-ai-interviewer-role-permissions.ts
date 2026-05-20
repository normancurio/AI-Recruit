/**
 * Read-only guard for the AI interviewer menu permission.
 *
 * It fails if legacy delivery/recruiting roles already include sys-interview-prompt.
 * Run before and after production migration to prove that old role presets did not
 * gain the new AI interviewer permission unless someone explicitly assigns it.
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(repoRoot, '.env.local') })
dotenv.config({ path: path.join(repoRoot, '.env') })

const AI_INTERVIEWER_MENU_ID = 'sys-interview-prompt'
const LEGACY_ROLE_NAMES = new Set([
  '交付经理',
  '招聘人员',
  '招聘专员',
  '招聘经理',
  'delivery_manager',
  'recruiter',
  'recruiting_manager'
])

function parseMenuKeys(raw: unknown): string[] {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean)
  if (Buffer.isBuffer(raw)) return parseMenuKeys(raw.toString('utf8'))
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map((x) => String(x || '').trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

async function main(): Promise<void> {
  const database = process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin'
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database
  })

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT id, name, menu_keys FROM roles ORDER BY id ASC'
    )
    const legacyWithAiMenu = rows
      .map((r) => ({
        id: String(r.id || ''),
        name: String(r.name || ''),
        menuKeys: parseMenuKeys(r.menu_keys)
      }))
      .filter((r) => LEGACY_ROLE_NAMES.has(r.name) && r.menuKeys.includes(AI_INTERVIEWER_MENU_ID))

    const aiRole = rows.find((r) => String(r.id || '') === 'R_AI_INTERVIEWER_MANAGER')
    const aiRoleMenuKeys = parseMenuKeys(aiRole?.menu_keys)
    console.log(
      JSON.stringify(
        {
          database,
          checkedLegacyRoles: Array.from(LEGACY_ROLE_NAMES),
          aiInterviewerRoleHasMenu: aiRoleMenuKeys.includes(AI_INTERVIEWER_MENU_ID),
          legacyRolesWithAiInterviewerMenu: legacyWithAiMenu
        },
        null,
        2
      )
    )

    if (legacyWithAiMenu.length) {
      throw new Error(
        `Legacy roles unexpectedly include ${AI_INTERVIEWER_MENU_ID}: ${legacyWithAiMenu
          .map((r) => `${r.name}(${r.id})`)
          .join(', ')}`
      )
    }
  } finally {
    await conn.end()
  }
}

main().catch((e: unknown) => {
  console.error('[verify-ai-interviewer-role-permissions] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
