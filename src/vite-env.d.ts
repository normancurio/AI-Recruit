/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  /** 与 server `.env.local` 中 `ADMIN_API_TOKEN` 相同，用于 HR 后台拉取 MySQL 数据 */
  readonly VITE_ADMIN_API_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
