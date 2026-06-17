import { apiUrl } from '../config/api'

export async function uploadAsrSegment(params: {
  blob: Blob
  sessionId: string
  questionId: string
  segmentIndex: number
  fileName?: string
}): Promise<string> {
  const form = new FormData()
  const name = params.fileName || `segment-${params.segmentIndex}.webm`
  form.append('file', params.blob, name)
  form.append('sessionId', params.sessionId)
  form.append('questionId', params.questionId)
  form.append('segmentIndex', String(params.segmentIndex))

  const res = await fetch(apiUrl('/api/candidate/ai-interview/asr'), {
    method: 'POST',
    body: form
  })
  let body: { data?: { text?: string }; message?: string } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    body = {}
  }
  if (!res.ok) {
    throw new Error(body?.message || `语音识别失败（HTTP ${res.status}）`)
  }
  return String(body?.data?.text || '').trim()
}
