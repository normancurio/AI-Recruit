let speechPrimed = false

/** 在用户点击链路内调用，解锁 Chrome 等对 speechSynthesis 的自动播放限制 */
export function primeSpeechSynthesis(): void {
  if (speechPrimed || typeof globalThis.speechSynthesis === 'undefined') return
  try {
    const synth = globalThis.speechSynthesis
    const utter = new SpeechSynthesisUtterance(' ')
    utter.volume = 0
    utter.rate = 10
    synth.speak(utter)
    synth.cancel()
    speechPrimed = true
  } catch {
    /* ignore */
  }
}

export function isSpeechPrimed(): boolean {
  return speechPrimed
}

type SpeechRecognitionCtor = new () => SpeechRecognition

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor())
}

function pickZhVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices()
  return (
    voices.find((v) => v.lang === 'zh-CN') ||
    voices.find((v) => v.lang.startsWith('zh')) ||
    null
  )
}

export function speakQuestion(
  text: string,
  onDone: () => void,
  onBlocked?: () => void
): () => void {
  const raw = String(text || '').trim()
  if (!raw || typeof globalThis.speechSynthesis === 'undefined') {
    onDone()
    return () => undefined
  }
  const synth = globalThis.speechSynthesis
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(raw.slice(0, 450))
  utter.lang = 'zh-CN'
  utter.rate = 0.95
  let done = false
  let started = false
  const finish = () => {
    if (done) return
    done = true
    utter.onstart = null
    utter.onend = null
    utter.onerror = null
    onDone()
  }
  utter.onstart = () => {
    started = true
  }
  utter.onend = finish
  utter.onerror = finish

  const startSpeak = () => {
    const voice = pickZhVoice(synth)
    if (voice) utter.voice = voice
    if (synth.paused) synth.resume()
    synth.speak(utter)
  }

  const voices = synth.getVoices()
  if (!voices.length) {
    synth.onvoiceschanged = () => {
      synth.onvoiceschanged = null
      startSpeak()
    }
    window.setTimeout(startSpeak, 150)
  } else {
    startSpeak()
  }

  // 未触发 onstart 多为浏览器自动播放策略拦截
  window.setTimeout(() => {
    if (!started && !done && !synth.speaking) {
      onBlocked?.()
    }
  }, 900)
  return () => {
    synth.cancel()
    finish()
  }
}

export type SpeechRecognizer = {
  start: () => void
  stop: () => void
  destroy: () => void
}

export function createSpeechRecognizer(handlers: {
  onResult: (text: string, isFinal: boolean) => void
  onError?: (message: string) => void
}): SpeechRecognizer | null {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'zh-CN'
  rec.continuous = true
  rec.interimResults = true
  let active = false

  rec.onresult = (evt: SpeechRecognitionEvent) => {
    let interim = ''
    let finalText = ''
    for (let i = evt.resultIndex; i < evt.results.length; i += 1) {
      const chunk = evt.results[i]?.[0]?.transcript || ''
      if (evt.results[i]?.isFinal) finalText += chunk
      else interim += chunk
    }
    if (finalText) handlers.onResult(finalText.trim(), true)
    else if (interim) handlers.onResult(interim.trim(), false)
  }
  rec.onerror = () => handlers.onError?.('语音识别异常，请检查麦克风权限')
  rec.onend = () => {
    if (!active) return
    try {
      rec.start()
    } catch {
      /* ignore */
    }
  }

  return {
    start: () => {
      active = true
      try {
        rec.start()
      } catch {
        handlers.onError?.('无法启动语音识别')
      }
    },
    stop: () => {
      active = false
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    },
    destroy: () => {
      active = false
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }
}
