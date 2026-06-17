import { uploadAsrSegment } from '../services/asrApi'

function pickRecorderMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export type ServerAsrRecorder = {
  start: () => Promise<void>
  stop: () => Promise<void>
  destroy: () => void
}

export function createServerAsrRecorder(opts: {
  sessionId: string
  getQuestionId: () => string
  onSegmentText: (text: string) => void
  onError?: (message: string) => void
  segmentMs?: number
}): ServerAsrRecorder | null {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null
  }

  const segmentMs = opts.segmentMs ?? 3500
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let segmentIndex = 0
  let active = false
  let uploadChain = Promise.resolve()

  const mimeType = pickRecorderMime()

  const uploadBlob = (blob: Blob) => {
    if (!blob.size) return
    const sid = opts.sessionId
    const qid = opts.getQuestionId()
    const idx = segmentIndex++
    uploadChain = uploadChain
      .then(() =>
        uploadAsrSegment({
          blob,
          sessionId: sid,
          questionId: qid,
          segmentIndex: idx,
          fileName: `segment-${idx}.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`
        })
      )
      .then((text) => {
        if (text) opts.onSegmentText(text)
      })
      .catch((e) => {
        opts.onError?.(e instanceof Error ? e.message : '服务端语音识别失败')
      })
  }

  return {
    start: async () => {
      if (active) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        const options = mimeType ? { mimeType } : undefined
        recorder = new MediaRecorder(stream, options)
        recorder.ondataavailable = (evt) => {
          if (evt.data?.size) uploadBlob(evt.data)
        }
        recorder.onerror = () => opts.onError?.('录音异常，请检查麦克风权限')
        recorder.start(segmentMs)
        active = true
      } catch {
        opts.onError?.('无法启动麦克风录音')
        throw new Error('mic denied')
      }
    },
    stop: async () => {
      active = false
      const rec = recorder
      recorder = null
      if (rec && rec.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          rec.onstop = () => resolve()
          try {
            rec.stop()
          } catch {
            resolve()
          }
        })
      }
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      await uploadChain
    },
    destroy: () => {
      active = false
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      recorder = null
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }
  }
}
