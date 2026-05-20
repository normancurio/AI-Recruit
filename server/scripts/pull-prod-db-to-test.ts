/**
 * Pull production MySQL data into the configured test/local MySQL target.
 *
 * Source: /opt/AI-Recruit/.env read over SSH from production.
 * Target: current repo .env / .env.local MYSQL_* values.
 *
 * Safety:
 * - production is read-only;
 * - target host must be in TEST_DB_HOST_ALLOWLIST;
 * - CONFIRM_OVERWRITE_TEST_DB=1 is required;
 * - after importing the admin DB, target users.password_hash is reset to 123456.
 */
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

dotenv.config({ path: path.join(repoRoot, '.env.local') })
dotenv.config({ path: path.join(repoRoot, '.env') })

const DEFAULT_PROD_SSH_HOST = 'root@47.102.85.156'
const DEFAULT_PROD_SSH_KEY = '/Users/jsonhe/.ssh/health'
const DEFAULT_PROD_APP_DIR = '/opt/AI-Recruit'
const DEFAULT_TEST_HOST_ALLOWLIST = ['127.0.0.1', 'localhost', '::1', '100.79.134.17']
const BATCH_SIZE = Math.max(100, Math.min(2000, Number(process.env.DB_PULL_BATCH_SIZE || 500)))
const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || '123456'

type DbPair = {
  label: string
  sourceDb: string
  targetDb: string
}

function unquote(v: string): string {
  return String(v || '').trim().replace(/^["']|["']$/g, '')
}

function qid(id: string): string {
  return `\`${String(id).replace(/`/g, '``')}\``
}

function readProdEnv(): Record<string, string> {
  const sshHost = process.env.PROD_SSH_HOST || DEFAULT_PROD_SSH_HOST
  const sshKey = process.env.PROD_SSH_KEY || DEFAULT_PROD_SSH_KEY
  const appDir = process.env.PROD_APP_DIR || DEFAULT_PROD_APP_DIR
  const args = [
    '-i',
    sshKey,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    sshHost,
    `cd ${shellQuote(appDir)} && cat .env`
  ]
  const raw = execFileSync('ssh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return Object.fromEntries(
    Object.entries(dotenv.parse(raw)).map(([k, v]) => [k, unquote(v)])
  )
}

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function sourceBase(prodEnv: Record<string, string>): mysql.ConnectionOptions {
  return {
    host: prodEnv.MYSQL_HOST || '127.0.0.1',
    port: Number(prodEnv.MYSQL_PORT || 3306),
    user: prodEnv.MYSQL_USER || 'root',
    password: prodEnv.MYSQL_PASSWORD || '',
    multipleStatements: false
  }
}

function targetBase(): mysql.ConnectionOptions {
  return {
    host: unquote(process.env.MYSQL_HOST || '127.0.0.1'),
    port: Number(unquote(process.env.MYSQL_PORT || '3306')),
    user: unquote(process.env.MYSQL_USER || 'root'),
    password: unquote(process.env.MYSQL_PASSWORD || ''),
    multipleStatements: true
  }
}

function assertSafeTarget(prodEnv: Record<string, string>): void {
  if (process.env.CONFIRM_OVERWRITE_TEST_DB !== '1') {
    throw new Error('Set CONFIRM_OVERWRITE_TEST_DB=1 to overwrite the configured test databases.')
  }

  const sourceHost = String(prodEnv.MYSQL_HOST || '').trim()
  const sourcePort = Number(prodEnv.MYSQL_PORT || 3306)
  const target = targetBase()
  const targetHost = String(target.host || '').trim()
  const targetPort = Number(target.port || 3306)
  const allowed = String(process.env.TEST_DB_HOST_ALLOWLIST || DEFAULT_TEST_HOST_ALLOWLIST.join(','))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

  if (!allowed.includes(targetHost)) {
    throw new Error(`Refusing target MYSQL_HOST=${targetHost}. Add it to TEST_DB_HOST_ALLOWLIST only if it is a test DB.`)
  }
  if (sourceHost === targetHost && sourcePort === targetPort) {
    throw new Error(`Source and target are both ${targetHost}:${targetPort}. Refusing to overwrite production.`)
  }
}

async function listBaseTables(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>('SHOW FULL TABLES WHERE Table_type = ?', ['BASE TABLE'])
  return rows.map((r) => String(Object.values(r)[0] || '')).filter(Boolean)
}

async function recreateTargetDatabase(conn: mysql.Connection, db: string): Promise<void> {
  await conn.query(`CREATE DATABASE IF NOT EXISTS ${qid(db)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await conn.query(`USE ${qid(db)}`)
  await conn.query('SET FOREIGN_KEY_CHECKS=0')
  const tables = await listBaseTables(conn)
  for (const table of tables.reverse()) {
    await conn.query(`DROP TABLE IF EXISTS ${qid(table)}`)
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1')
}

async function copyTable(source: mysql.Connection, target: mysql.Connection, table: string): Promise<void> {
  console.log(`[pull-prod]   ${table}: copying`)
  const [[createRow]] = await source.query<RowDataPacket[]>(`SHOW CREATE TABLE ${qid(table)}`)
  const createSql = String(createRow?.['Create Table'] || '')
  if (!createSql) throw new Error(`SHOW CREATE TABLE returned empty SQL for ${table}`)
  await target.query(createSql)

  const [[cntRow]] = await source.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${qid(table)}`)
  const total = Number(cntRow?.n || 0)
  if (total === 0) {
    console.log(`[pull-prod]   ${table}: schema only`)
    return
  }

  const [fieldRows] = await source.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${qid(table)}`)
  const columns = fieldRows
    .filter((r) => !/GENERATED/i.test(String(r.Extra || '')))
    .map((r) => String(r.Field || ''))
    .filter(Boolean)
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`

  let copied = 0
  while (copied < total) {
    const [rows] = await source.query<RowDataPacket[]>(
      `SELECT * FROM ${qid(table)} LIMIT ? OFFSET ?`,
      [BATCH_SIZE, copied]
    )
    if (!rows.length) break
    const placeholders = rows.map(() => rowPlaceholder).join(', ')
    const values = rows.flatMap((row) => columns.map((c) => normalizeValue(row[c])))
    await target.query(`INSERT INTO ${qid(table)} (${columns.map(qid).join(', ')}) VALUES ${placeholders}`, values)
    copied += rows.length
  }
  console.log(`[pull-prod]   ${table}: ${copied}/${total} rows`)
}

function normalizeValue(v: unknown): unknown {
  if (v == null) return v
  if (v instanceof Date) return v
  if (Buffer.isBuffer(v)) return v
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hex = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hex}`
}

async function resetTargetAdminPasswords(target: mysql.Connection, adminDb: string): Promise<void> {
  await target.query(`USE ${qid(adminDb)}`)
  const [cols] = await target.query<RowDataPacket[]>(
    'SHOW COLUMNS FROM users WHERE Field = ?',
    ['password_hash']
  )
  if (!cols.length) {
    await target.query('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL AFTER status')
  }
  const hash = hashAdminPassword(LOCAL_ADMIN_PASSWORD)
  const [ret] = await target.query<mysql.ResultSetHeader>('UPDATE users SET password_hash = ?', [hash])
  console.log(`[pull-prod] reset target admin user passwords to ${LOCAL_ADMIN_PASSWORD}: ${ret.affectedRows} rows`)
}

async function copyDatabase(prodEnv: Record<string, string>, pair: DbPair): Promise<void> {
  const source = await mysql.createConnection({ ...sourceBase(prodEnv), database: pair.sourceDb })
  const target = await mysql.createConnection(targetBase())
  try {
    console.log(`[pull-prod] ${pair.label}: prod ${pair.sourceDb} -> test ${pair.targetDb}`)
    await recreateTargetDatabase(target, pair.targetDb)
    await target.query(`USE ${qid(pair.targetDb)}`)
    await target.query('SET FOREIGN_KEY_CHECKS=0')
    const tables = await listBaseTables(source)
    for (const table of tables) await copyTable(source, target, table)
    await target.query('SET FOREIGN_KEY_CHECKS=1')
    if (pair.label === 'admin') await resetTargetAdminPasswords(target, pair.targetDb)
  } finally {
    await source.end()
    await target.end()
  }
}

async function main(): Promise<void> {
  const prodEnv = readProdEnv()
  assertSafeTarget(prodEnv)

  const target = targetBase()
  const pairs: DbPair[] = [
    {
      label: 'business',
      sourceDb: prodEnv.MYSQL_DATABASE || 'ai_recruit',
      targetDb: unquote(process.env.MYSQL_DATABASE || 'ai_recruit')
    },
    {
      label: 'admin',
      sourceDb: prodEnv.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin',
      targetDb: unquote(process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin')
    }
  ]

  console.log(`[pull-prod] source prod ${prodEnv.MYSQL_USER || 'root'}@${prodEnv.MYSQL_HOST || '127.0.0.1'}:${prodEnv.MYSQL_PORT || 3306}`)
  console.log(`[pull-prod] target test ${target.user || 'root'}@${target.host || '127.0.0.1'}:${target.port || 3306}`)
  for (const pair of pairs) await copyDatabase(prodEnv, pair)
  console.log('[pull-prod] done')
}

main().catch((e: unknown) => {
  console.error('[pull-prod] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
