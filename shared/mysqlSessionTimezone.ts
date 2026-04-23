import type { Pool } from 'mysql2/promise'

/**
 * 与业务展示一致，默认中国东八区。可通过 MYSQL_TIMEZONE 覆盖（如 +00:00）。
 * 与 mysql2 的 `timezone` 及每条连接上 `SET time_zone` 需保持一致。
 */
export const MYSQL_SESSION_TIMEZONE = (() => {
  const t = String(process.env.MYSQL_TIMEZONE || '+08:00').trim()
  return t || '+08:00'
})()

/**
 * mysql2：将 MySQL 返回的 DATETIME/TIMESTAMP 字符串按此时区解析为 JavaScript Date。
 * 避免 Node 运行环境为 UTC 时，把东八区墙钟误当 UTC，JSON 成 `Z` 后再经前端加 8 小时展示导致「多 8 小时」。
 */
export const mysqlConnectionTimezoneOptions = { timezone: MYSQL_SESSION_TIMEZONE } as const

/**
 * 每条连接设置 SESSION time_zone，与 `mysqlConnectionTimezoneOptions` 一致，
 * 使 TIMESTAMP 的读写、NOW() 与表工具里看到的时区统一。
 */
export function wireMysqlSessionTimezone(pool: Pool): void {
  pool.on('connection', (connection) => {
    void (async () => {
      try {
        await connection.query('SET time_zone = ?', [MYSQL_SESSION_TIMEZONE])
      } catch (err) {
        console.error('[mysql] SET time_zone failed', err)
      }
    })()
  })
}
