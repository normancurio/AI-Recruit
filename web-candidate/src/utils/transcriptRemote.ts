import { syncLiveTranscript } from '../services/interviewApi'

const TRANSCRIPT_REMOTE_DEBOUNCE_MS = 600

export type TranscriptRemoteSync = {
  schedule: (sessionId: string, fullText: string, meta?: { questionId?: string; question?: string }) => void
  flushNow: (sessionId: string, fullText: string, meta?: { questionId?: string; question?: string }) => void
  cancel: () => void
  destroy: () => void
}

export function createTranscriptRemoteSync(hooks?: {
  onAfterFlush?: (
    sessionId: string,
    fullText: string,
    meta?: { questionId?: string; question?: string }
  ) => void
}): TranscriptRemoteSync {
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest = ''
  let latestSid = ''
  let latestMeta: { questionId?: string; question?: string } | undefined

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flushNow = (
    sessionId: string,
    fullText: string,
    meta?: { questionId?: string; question?: string }
  ) => {
    cancel()
    const t = String(fullText || '').trim()
    if (!t || !sessionId) return
    void syncLiveTranscript(sessionId, t, meta)
    hooks?.onAfterFlush?.(sessionId, t, meta)
  }

  const schedule = (
    sessionId: string,
    fullText: string,
    meta?: { questionId?: string; question?: string }
  ) => {
    latest = fullText
    latestSid = sessionId
    latestMeta = meta
    cancel()
    timer = setTimeout(() => {
      timer = null
      flushNow(latestSid, latest, latestMeta)
    }, TRANSCRIPT_REMOTE_DEBOUNCE_MS)
  }

  const destroy = () => cancel()

  return { schedule, flushNow, cancel, destroy }
}
