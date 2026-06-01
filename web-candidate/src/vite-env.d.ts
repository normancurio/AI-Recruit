/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_API_PROXY_TARGET?: string
  readonly VITE_AI_INTERVIEWER_IMG_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
