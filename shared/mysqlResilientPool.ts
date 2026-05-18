import mysql from 'mysql2/promise'
import type { Pool, PoolOptions } from 'mysql2/promise'
import { mysqlConnectionTimezoneOptions, wireMysqlSessionTimezone } from './mysqlSessionTimezone'

const TRANSIENT_MYSQL_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT'
])

/** 是否为可重试的瞬时连接错误（空闲断线、网络抖动等） */
export function isMysqlTransientError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code || '')
  if (TRANSIENT_MYSQL_CODES.has(code)) return true
  const errno = (e as { errno?: number })?.errno
  if (errno === -54 || errno === -61) return true
  const msg = String((e as Error)?.message || '')
  return /ECONNRESET|Connection lost|read ECONNRESET|server has gone away/i.test(msg)
}

function mysqlQueryMaxAttempts(): number {
  const n = Number(process.env.MYSQL_QUERY_MAX_ATTEMPTS || 3)
  return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.floor(n))) : 3
}

/**
 * 创建带 keep-alive 与查询自动重试的 MySQL 连接池（缓解远程库 ECONNRESET）。
 */
export function createResilientMysqlPool(opts: PoolOptions): Pool {
  const pool = mysql.createPool({
    ...opts,
    ...mysqlConnectionTimezoneOptions,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  })
  wireMysqlSessionTimezone(pool)

  const baseQuery = pool.query.bind(pool)
  pool.query = (async (...args: Parameters<typeof baseQuery>) => {
    const max = mysqlQueryMaxAttempts()
    let last: unknown
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        return await baseQuery(...args)
      } catch (e) {
        last = e
        if (!isMysqlTransientError(e) || attempt >= max) throw e
        await new Promise((r) => setTimeout(r, 40 * attempt))
      }
    }
    throw last
  }) as typeof pool.query

  return pool
}
