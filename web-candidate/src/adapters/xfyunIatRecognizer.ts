import { fetchXfyunIatAuth } from '../services/xfyunApi'
import { formatXfyunError, isXfyunFatalError } from '../utils/xfyunErrors'

const TARGET_SAMPLE_RATE = 16000
const FRAME_BYTES = 1280
const FRAME_INTERVAL_MS = 40
/** 句间静音多久后讯飞判定一句结束；面试作答适当放宽 */
const XFYUN_EOS_MS = 5000

function downsampleToPcm16(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === TARGET_SAMPLE_RATE) {
    const out = new Int16Array(input.length)
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]))
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return out
  }
  const ratio = inputRate / TARGET_SAMPLE_RATE
  const outLen = Math.max(1, Math.round(input.length / ratio))
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i += 1) {
    const idx = Math.min(input.length - 1, Math.floor(i * ratio))
    const s = Math.max(-1, Math.min(1, input[idx]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode(...sub)
  }
  return btoa(binary)
}

type WsWord = { w?: string }
type WsItem = { cw?: WsWord[] }
type WsResult = {
  ls?: boolean
  pgs?: string
  rg?: number[]
  ws?: WsItem[]
}

function parseFrame(
  payload: { code?: number; message?: string; data?: { result?: WsResult; status?: number } },
  state: { finals: string[]; partial: string }
): { text: string; isFinal: boolean; error?: string; fatal?: boolean; code?: number } | null {
  if (payload.code !== 0) {
    const msg = formatXfyunError(payload.message || '', payload.code)
    return {
      text: '',
      isFinal: false,
      error: msg,
      fatal: isXfyunFatalError(payload.message || '', payload.code),
      code: payload.code
    }
  }
  const result = payload.data?.result
  if (!result?.ws?.length) {
    if (payload.data?.status === 2) {
      const text = state.finals.join('') + state.partial
      return text ? { text, isFinal: true } : null
    }
    return null
  }
  const piece = result.ws
    .map((w) => w.cw?.map((c) => c.w || '').join('') || '')
    .join('')
  if (!piece) return null

  if (result.pgs === 'rpl' && Array.isArray(result.rg) && result.rg.length >= 2) {
    const [from, to] = result.rg
    const start = Math.max(0, from - 1)
    const end = Math.max(start, to)
    state.finals.splice(start, end - start + 1, piece)
    state.partial = ''
  } else if (result.pgs === 'apd') {
    state.finals.push(piece)
    state.partial = ''
  } else {
    state.partial = piece
  }

  const isFinal = Boolean(result.ls) || payload.data?.status === 2
  if (isFinal && state.partial) {
    state.finals.push(state.partial)
    state.partial = ''
  }
  const text = state.finals.join('') + state.partial
  return { text, isFinal }
}

export type XfyunIatRecognizer = {
  start: () => Promise<void>
  stop: () => Promise<void>
  destroy: () => void
}

export function createXfyunIatRecognizer(handlers: {
  onResult: (text: string, isFinal: boolean) => void
  onUtteranceEnd?: () => void
  onError?: (message: string) => void
}): XfyunIatRecognizer | null {
  if (typeof WebSocket === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null
  }

  let ws: WebSocket | null = null
  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let processor: ScriptProcessorNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let active = false
  let sendTimer: ReturnType<typeof setInterval> | null = null
  let pcmQueue: number[] = []
  let firstFrameSent = false
  let appId = ''
  let reconnecting = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let fatalStopped = false
  const parseState = { finals: [] as string[], partial: '' }

  const resetUtteranceState = () => {
    parseState.finals = []
    parseState.partial = ''
    firstFrameSent = false
  }

  const clearSendTimer = () => {
    if (sendTimer) {
      clearInterval(sendTimer)
      sendTimer = null
    }
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const closeWsOnly = () => {
    const sock = ws
    ws = null
    if (!sock) return
    try {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ data: { status: 2 } }))
      }
      sock.close()
    } catch {
      /* ignore */
    }
  }

  const flushPcmFrame = (status: 0 | 1 | 2) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || reconnecting) return
    if (status === 2) {
      try {
        ws.send(JSON.stringify({ data: { status: 2 } }))
      } catch {
        /* ignore */
      }
      return
    }
    const take = Math.min(FRAME_BYTES / 2, pcmQueue.length)
    if (take <= 0) return
    const samples = pcmQueue.splice(0, take)
    const buf = new Int16Array(samples)
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    const frame: Record<string, unknown> = {
      data: {
        status,
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: bytesToBase64(bytes)
      }
    }
    if (!firstFrameSent) {
      frame.common = { app_id: appId }
      frame.business = {
        language: 'zh_cn',
        domain: 'iat',
        accent: 'mandarin',
        ptt: 1,
        eos: XFYUN_EOS_MS
      }
      firstFrameSent = true
    }
    try {
      ws.send(JSON.stringify(frame))
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e.message : '讯飞发送音频失败')
      void scheduleReconnect()
    }
  }

  const bindWsHandlers = (sock: WebSocket) => {
    sock.onmessage = (msg) => {
      try {
        const payload = JSON.parse(String(msg.data)) as Parameters<typeof parseFrame>[0]
        const parsed = parseFrame(payload, parseState)
        if (!parsed) return
        if (parsed.error) {
          const err = parsed.error.toLowerCase()
          if (parsed.fatal) {
            fatalStopped = true
            active = false
            handlers.onError?.(parsed.error)
            return
          }
          if (err.includes('invalid handle') || err.includes('会话异常')) {
            void scheduleReconnect()
            return
          }
          handlers.onError?.(parsed.error)
          return
        }
        if (parsed.text) handlers.onResult(parsed.text, parsed.isFinal)
        if (parsed.isFinal) {
          handlers.onUtteranceEnd?.()
          void scheduleReconnect()
        }
      } catch {
        /* ignore malformed frame */
      }
    }
    sock.onclose = () => {
      if (!active || reconnecting) return
      void scheduleReconnect()
    }
    sock.onerror = () => {
      if (!active) return
      void scheduleReconnect()
    }
  }

  const openWsSession = async (): Promise<void> => {
    const auth = await fetchXfyunIatAuth()
    appId = auth.appId
    resetUtteranceState()
    await new Promise<void>((resolve, reject) => {
      const sock = new WebSocket(auth.wsUrl)
      ws = sock
      sock.onopen = () => resolve()
      sock.onerror = () => reject(new Error('讯飞 WebSocket 连接失败'))
      bindWsHandlers(sock)
    })
  }

  const scheduleReconnect = async () => {
    if (!active || reconnecting || fatalStopped) return
    reconnecting = true
    clearReconnectTimer()
    closeWsOnly()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!active) {
        reconnecting = false
        return
      }
      void openWsSession()
        .then(() => {
          reconnecting = false
        })
        .catch((e) => {
          reconnecting = false
          handlers.onError?.(e instanceof Error ? e.message : '讯飞重连失败')
        })
    }, 180)
  }

  const teardownAudio = () => {
    clearSendTimer()
    clearReconnectTimer()
    processor?.disconnect()
    source?.disconnect()
    processor = null
    source = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void audioContext?.close().catch(() => undefined)
    audioContext = null
    pcmQueue = []
    firstFrameSent = false
  }

  return {
    start: async () => {
      if (active) return
      active = true
      reconnecting = false
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      audioContext = new AudioContext()
      await audioContext.resume().catch(() => undefined)
      source = audioContext.createMediaStreamSource(stream)
      processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (evt) => {
        if (!active || reconnecting) return
        const input = evt.inputBuffer.getChannelData(0)
        const pcm = downsampleToPcm16(input, audioContext?.sampleRate || TARGET_SAMPLE_RATE)
        for (let i = 0; i < pcm.length; i += 1) pcmQueue.push(pcm[i])
      }
      source.connect(processor)
      const mute = audioContext.createGain()
      mute.gain.value = 0
      processor.connect(mute)
      mute.connect(audioContext.destination)

      await openWsSession()

      sendTimer = setInterval(() => {
        if (!active || reconnecting) return
        if (pcmQueue.length >= FRAME_BYTES / 2) {
          flushPcmFrame(firstFrameSent ? 1 : 0)
        }
      }, FRAME_INTERVAL_MS)
    },
    stop: async () => {
      active = false
      reconnecting = false
      clearSendTimer()
      clearReconnectTimer()
      flushPcmFrame(2)
      closeWsOnly()
      teardownAudio()
      resetUtteranceState()
    },
    destroy: () => {
      active = false
      reconnecting = false
      clearSendTimer()
      clearReconnectTimer()
      closeWsOnly()
      teardownAudio()
      resetUtteranceState()
    }
  }
}
