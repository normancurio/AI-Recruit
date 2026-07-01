import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createServerAsrRecorder } from '../adapters/serverAsrRecorder'
import { createXfyunIatRecognizer } from '../adapters/xfyunIatRecognizer'
import { syncTrtcRoomSignal } from '../services/interviewApi'
import type { InterviewQuestion } from '../types/interview'
import { ensureMicPermission } from '../utils/media'
import { shouldDropQuestionEcho } from '../utils/transcriptEcho'
import { sanitizeTranscriptText } from '../utils/transcriptSanitize'
import { createTranscriptRemoteSync } from '../utils/transcriptRemote'
import { createSpeechRecognizer, isSpeechRecognitionSupported, speakQuestion } from '../utils/speech'

export type AsrMode = 'xfyun' | 'web' | 'server' | 'manual'

const ANSWER_GATE_DELAY_MS = 220
const TTS_TAIL_IGNORE_MS = 360
const ASR_HANDOFF_DELAY_MS = 320
const ASR_NO_RESULT_WATCHDOG_MS = 6500

type Options = {
  sessionId: string
  getCurrentQuestion: () => InterviewQuestion | undefined
  onStatus?: (line: string) => void
  /** TRTC 房间内自定义消息（与 HTTP trtc-signal 双写） */
  onTrtcSubtitle?: (text: string) => void
}

export function useAnswerTranscript({
  sessionId,
  getCurrentQuestion,
  onStatus,
  onTrtcSubtitle
}: Options) {
  const [finalized, setFinalized] = useState<string[]>([])
  const [streaming, setStreaming] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [showAnswerTranscript, setShowAnswerTranscript] = useState(false)
  const [asrMode, setAsrMode] = useState<AsrMode>('xfyun')

  const finalizedRef = useRef<string[]>([])
  finalizedRef.current = finalized

  const onTrtcSubtitleRef = useRef(onTrtcSubtitle)
  onTrtcSubtitleRef.current = onTrtcSubtitle

  const remoteSyncRef = useRef(
    createTranscriptRemoteSync({
      onAfterFlush: (sid, text) => {
        void syncTrtcRoomSignal(sid, text, 'subtitle')
        onTrtcSubtitleRef.current?.(text)
      }
    })
  )
  const webRecRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(null)
  const xfyunRecRef = useRef<ReturnType<typeof createXfyunIatRecognizer> | null>(null)
  const serverRecRef = useRef<ReturnType<typeof createServerAsrRecorder> | null>(null)
  const stopTtsRef = useRef<(() => void) | null>(null)

  const questionTtsPlayingRef = useRef(false)
  const answerTranscriptOpenRef = useRef(false)
  const answerOpenedAtRef = useRef(0)
  const ignoreRecognizeBeforeTsRef = useRef(0)
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const webErrorCountRef = useRef(0)
  const pendingTtsRef = useRef<string | null>(null)
  const pendingTapTtsRef = useRef<string | null>(null)
  const asrWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [needsTapToSpeak, setNeedsTapToSpeak] = useState(false)

  const clearAsrWatchdog = useCallback(() => {
    if (asrWatchdogRef.current) {
      clearTimeout(asrWatchdogRef.current)
      asrWatchdogRef.current = null
    }
  }, [])

  const spokenText = useMemo(
    () => (finalized.join('') + streaming).trim(),
    [finalized, streaming]
  )

  const getQuestionMeta = useCallback(() => {
    const q = getCurrentQuestion()
    return { questionId: q?.id || '', question: q?.text || '' }
  }, [getCurrentQuestion])

  const pushRemoteSchedule = useCallback(
    (fullText: string) => {
      if (!sessionId) return
      remoteSyncRef.current.schedule(sessionId, fullText, getQuestionMeta())
    },
    [getQuestionMeta, sessionId]
  )

  const pushRemoteNow = useCallback(
    (fullText: string) => {
      if (!sessionId) return
      remoteSyncRef.current.flushNow(sessionId, fullText, getQuestionMeta())
    },
    [getQuestionMeta, sessionId]
  )

  const clearGateTimer = useCallback(() => {
    if (gateTimerRef.current) {
      clearTimeout(gateTimerRef.current)
      gateTimerRef.current = null
    }
  }, [])

  const closeAnswerDisplay = useCallback(() => {
    answerTranscriptOpenRef.current = false
    setShowAnswerTranscript(false)
    clearGateTimer()
  }, [clearGateTimer])

  const appendFinalText = useCallback(
    (text: string) => {
      const t = sanitizeTranscriptText(text)
      if (!t) return
      clearAsrWatchdog()
      remoteSyncRef.current.cancel()
      setFinalized((prev) => {
        const base = prev.join('')
        let delta = t
        if (base && t.startsWith(base)) delta = t.slice(base.length).trim()
        if (!delta || base.endsWith(delta)) return prev
        const next = [...prev, delta]
        finalizedRef.current = next
        pushRemoteNow(next.join(''))
        return next
      })
      setStreaming('')
    },
    [clearAsrWatchdog, pushRemoteNow]
  )

  /** 对齐小程序：本句定稿写入历史，清空流式区 */
  const flushUtteranceToHistory = useCallback(
    (utterance: string) => {
      const t = sanitizeTranscriptText(utterance)
      if (!t) {
        setStreaming('')
        return
      }
      appendFinalText(t)
    },
    [appendFinalText]
  )

  const acceptStreaming = useCallback(
    (text: string) => {
      if (!answerTranscriptOpenRef.current) return
      if (questionTtsPlayingRef.current) return
      if (Date.now() < ignoreRecognizeBeforeTsRef.current) return
      const t = sanitizeTranscriptText(text)
      if (!t) return
      const q = getCurrentQuestion()
      if (
        shouldDropQuestionEcho({
          raw: t,
          questionText: q?.text || '',
          answerOpenedAt: answerOpenedAtRef.current,
          isFollowUp: q?.type === 'follow_up'
        })
      ) {
        return
      }
      clearAsrWatchdog()
      const base = finalizedRef.current.join('')
      setStreaming(t)
      pushRemoteSchedule(base + t)
    },
    [clearAsrWatchdog, getCurrentQuestion, pushRemoteSchedule]
  )

  const destroyWebRec = useCallback(() => {
    webRecRef.current?.destroy()
    webRecRef.current = null
  }, [])

  const destroyXfyunRec = useCallback(() => {
    xfyunRecRef.current?.destroy()
    xfyunRecRef.current = null
  }, [])

  const destroyServerRec = useCallback(() => {
    serverRecRef.current?.destroy()
    serverRecRef.current = null
  }, [])

  const stopAsr = useCallback(async () => {
    clearAsrWatchdog()
    destroyWebRec()
    destroyXfyunRec()
    if (serverRecRef.current) {
      try {
        await serverRecRef.current.stop()
      } catch {
        /* ignore */
      }
      serverRecRef.current = null
    }
    setTranscribing(false)
  }, [clearAsrWatchdog, destroyWebRec, destroyXfyunRec])

  const asrModeRef = useRef(asrMode)
  asrModeRef.current = asrMode
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
  const startServerRecognizerRef = useRef<() => Promise<boolean>>(async () => false)

  const scheduleAsrWatchdog = useCallback(() => {
    clearAsrWatchdog()
    asrWatchdogRef.current = setTimeout(() => {
      asrWatchdogRef.current = null
      if (!answerTranscriptOpenRef.current || questionTtsPlayingRef.current) return
      const hasText = finalizedRef.current.length > 0 || Boolean(streamingRef.current)
      if (hasText) return
      const mode = asrModeRef.current
      if (mode === 'xfyun') {
        onStatus?.('请对着麦克风说话（讯飞转写）')
        return
      }
      if (mode === 'server') {
        onStatus?.('未检测到语音，请对着麦克风说话或检查浏览器麦克风权限')
      }
    }, ASR_NO_RESULT_WATCHDOG_MS)
  }, [clearAsrWatchdog, onStatus])

  const stopOtherRecognizers = useCallback(() => {
    destroyWebRec()
    destroyXfyunRec()
    destroyServerRec()
  }, [destroyServerRec, destroyWebRec, destroyXfyunRec])

  const openAnswerGate = useCallback(
    (preserveAccumulated: boolean) => {
      clearGateTimer()
      answerTranscriptOpenRef.current = false
      if (!preserveAccumulated) {
        finalizedRef.current = []
        setFinalized([])
        setStreaming('')
      } else {
        setShowAnswerTranscript(true)
      }
      gateTimerRef.current = setTimeout(() => {
        gateTimerRef.current = null
        answerOpenedAtRef.current = Date.now()
        answerTranscriptOpenRef.current = true
        setShowAnswerTranscript(true)
      }, ANSWER_GATE_DELAY_MS)
    },
    [clearGateTimer]
  )

  const startServerRecognizer = useCallback(async () => {
    stopOtherRecognizers()
    destroyServerRec()
    const micOk = await ensureMicPermission()
    if (!micOk) {
      setAsrMode('manual')
      onStatus?.('麦克风权限未开启，请手动输入回答')
      return false
    }
    const rec = createServerAsrRecorder({
      sessionId,
      getQuestionId: () => getCurrentQuestion()?.id || '',
      onSegmentText: (text) => {
        if (!answerTranscriptOpenRef.current || questionTtsPlayingRef.current) return
        if (Date.now() < ignoreRecognizeBeforeTsRef.current) return
        const t = sanitizeTranscriptText(text)
        if (!t) return
        const q = getCurrentQuestion()
        if (
          shouldDropQuestionEcho({
            raw: t,
            questionText: q?.text || '',
            answerOpenedAt: answerOpenedAtRef.current,
            isFollowUp: q?.type === 'follow_up'
          })
        ) {
          return
        }
        flushUtteranceToHistory(t)
      },
      onError: (msg) => onStatus?.(msg)
    })
    if (!rec) {
      setAsrMode('manual')
      onStatus?.('无法使用语音转写，请手动输入回答')
      return false
    }
    serverRecRef.current = rec
    try {
      await rec.start()
      setTranscribing(true)
      onStatus?.('正在聆听，请口述作答（约几秒后显示转写）')
      scheduleAsrWatchdog()
      return true
    } catch {
      setAsrMode('manual')
      onStatus?.('麦克风不可用，请手动输入回答')
      return false
    }
  }, [
    destroyServerRec,
    flushUtteranceToHistory,
    getCurrentQuestion,
    onStatus,
    scheduleAsrWatchdog,
    sessionId,
    stopOtherRecognizers
  ])

  startServerRecognizerRef.current = startServerRecognizer

  const startXfyunRecognizer = useCallback(async () => {
    stopOtherRecognizers()
    destroyXfyunRec()
    const micOk = await ensureMicPermission()
    if (!micOk) {
      setAsrMode('manual')
      onStatus?.('麦克风权限未开启，请手动输入或刷新后重试')
      return false
    }
    const rec = createXfyunIatRecognizer({
      onResult: (text, isFinal) => {
        const t = sanitizeTranscriptText(text)
        if (!t) return
        clearAsrWatchdog()
        if (isFinal) {
          flushUtteranceToHistory(t)
        } else {
          acceptStreaming(t)
        }
      },
      onUtteranceEnd: () => {
        answerTranscriptOpenRef.current = true
        setShowAnswerTranscript(true)
        scheduleAsrWatchdog()
      },
      onError: (msg) => {
        const lower = msg.toLowerCase()
        if (lower.includes('invalid handle') || lower.includes('会话异常')) return
        onStatus?.(msg)
      }
    })
    if (!rec) {
      setAsrMode('manual')
      onStatus?.('当前环境不支持讯飞转写，请手动输入回答')
      return false
    }
    xfyunRecRef.current = rec
    try {
      await rec.start()
      setTranscribing(true)
      onStatus?.('讯飞转写已开启，请口述作答')
      scheduleAsrWatchdog()
      return true
    } catch (e) {
      destroyXfyunRec()
      setAsrMode('manual')
      onStatus?.(e instanceof Error ? e.message : '讯飞转写启动失败，请手动输入')
      return false
    }
  }, [
    acceptStreaming,
    destroyXfyunRec,
    flushUtteranceToHistory,
    onStatus,
    scheduleAsrWatchdog,
    stopOtherRecognizers
  ])

  const startWebRecognizer = useCallback(() => {
    stopOtherRecognizers()
    destroyWebRec()
    const rec = createSpeechRecognizer({
      onResult: (text, isFinal) => {
        if (isFinal) flushUtteranceToHistory(text)
        else acceptStreaming(text)
      },
      onError: (msg) => {
        webErrorCountRef.current += 1
        onStatus?.(msg)
        if (webErrorCountRef.current >= 2) {
          destroyWebRec()
          setAsrMode('manual')
          onStatus?.('浏览器转写不稳定，请手动输入回答')
        }
      }
    })
    if (!rec) {
      setAsrMode('manual')
      return false
    }
    webRecRef.current = rec
    rec.start()
    setTranscribing(true)
    scheduleAsrWatchdog()
    return true
  }, [acceptStreaming, destroyWebRec, flushUtteranceToHistory, onStatus, scheduleAsrWatchdog, stopOtherRecognizers])

  const startAnswerRecognition = useCallback(
    async (preserveAccumulated = false) => {
      webErrorCountRef.current = 0
      openAnswerGate(preserveAccumulated)
      if (typeof globalThis.speechSynthesis !== 'undefined') {
        globalThis.speechSynthesis.cancel()
      }
      const mode = asrModeRef.current
      if (mode === 'manual') {
        setShowAnswerTranscript(true)
        answerTranscriptOpenRef.current = true
        return
      }
      if (mode === 'xfyun') {
        await startXfyunRecognizer()
        return
      }
      if (mode === 'server') {
        const ok = await startServerRecognizer()
        if (!ok && isSpeechRecognitionSupported()) {
          const webOk = startWebRecognizer()
          if (!webOk) {
            setAsrMode('manual')
            onStatus?.('语音转写不可用，请手动输入回答')
          }
        }
        return
      }
      const webOk = startWebRecognizer()
      if (!webOk) await startServerRecognizer()
    },
    [onStatus, openAnswerGate, startServerRecognizer, startWebRecognizer, startXfyunRecognizer]
  )

  const playTtsThenAnswer = useCallback(
    (ttsText: string) => {
      const text = String(ttsText || '').trim()
      if (!text) {
        onStatus?.('请口述您的回答')
        void startAnswerRecognition(false)
        return
      }
      void stopAsr()
      questionTtsPlayingRef.current = true
      setNeedsTapToSpeak(false)
      pendingTapTtsRef.current = null
      const isFollowUpQ = getCurrentQuestion()?.type === 'follow_up'
      onStatus?.(isFollowUpQ ? 'AI 正在读追问…' : 'AI 正在读题…')
      closeAnswerDisplay()
      finalizedRef.current = []
      setFinalized([])
      setStreaming('')
      remoteSyncRef.current.cancel()

      const ttsStartAt = Date.now()
      const minTtsCoverMs = Math.max(1800, Math.min(8000, text.length * 70 + 1000))
      ignoreRecognizeBeforeTsRef.current = ttsStartAt + minTtsCoverMs

      const releaseAfterTts = () => {
        const elapsed = Date.now() - ttsStartAt
        const holdMs = Math.max(0, minTtsCoverMs - elapsed)
        const release = () => {
          questionTtsPlayingRef.current = false
          ignoreRecognizeBeforeTsRef.current = Date.now() + TTS_TAIL_IGNORE_MS
          setStreaming('')
          onStatus?.('请口述您的回答')
          if (typeof globalThis.speechSynthesis !== 'undefined') {
            globalThis.speechSynthesis.cancel()
          }
          window.setTimeout(() => {
            void startAnswerRecognition(false)
          }, ASR_HANDOFF_DELAY_MS)
        }
        if (holdMs <= 0) release()
        else setTimeout(release, holdMs)
      }

      stopTtsRef.current?.()
      stopTtsRef.current = speakQuestion(
        text,
        releaseAfterTts,
        () => {
          questionTtsPlayingRef.current = false
          pendingTapTtsRef.current = text
          setNeedsTapToSpeak(true)
          onStatus?.('自动读题被拦截，请点击页面开始语音读题')
        }
      )
    },
    [closeAnswerDisplay, getCurrentQuestion, onStatus, startAnswerRecognition, stopAsr]
  )

  const retrySpeakAfterTap = useCallback(() => {
    const text = pendingTapTtsRef.current
    if (!text) return
    pendingTapTtsRef.current = null
    setNeedsTapToSpeak(false)
    playTtsThenAnswer(text)
  }, [playTtsThenAnswer])

  const beginQuestion = useCallback(
    (questionText: string) => {
      pendingTtsRef.current = questionText
      void stopAsr().then(() => {
        const t = pendingTtsRef.current
        pendingTtsRef.current = null
        playTtsThenAnswer(t || '')
      })
    },
    [playTtsThenAnswer, stopAsr]
  )

  const resetForNextQuestion = useCallback(() => {
    remoteSyncRef.current.cancel()
    setStreaming('')
    setFinalized([])
    finalizedRef.current = []
  }, [])

  const stopAll = useCallback(async () => {
    stopTtsRef.current?.()
    stopTtsRef.current = null
    questionTtsPlayingRef.current = false
    pendingTtsRef.current = null
    pendingTapTtsRef.current = null
    setNeedsTapToSpeak(false)
    closeAnswerDisplay()
    remoteSyncRef.current.cancel()
    await stopAsr()
  }, [closeAnswerDisplay, stopAsr])

  const flushBeforeSubmit = useCallback(() => {
    const tail = sanitizeTranscriptText(streaming)
    if (tail) {
      const base = finalizedRef.current.join('')
      if (!base.endsWith(tail)) {
        const merged = base + tail
        finalizedRef.current = [merged]
        setFinalized([merged])
        setStreaming('')
        pushRemoteNow(merged)
        remoteSyncRef.current.cancel()
        return
      }
    }
    pushRemoteNow(finalizedRef.current.join('') + streaming)
    remoteSyncRef.current.cancel()
  }, [pushRemoteNow, streaming])

  useEffect(() => {
    return () => {
      stopTtsRef.current?.()
      remoteSyncRef.current.destroy()
      destroyWebRec()
      destroyXfyunRec()
      destroyServerRec()
    }
  }, [destroyServerRec, destroyWebRec, destroyXfyunRec])

  return {
    finalized,
    streaming,
    spokenText,
    transcribing,
    showAnswerTranscript,
    asrMode,
    beginQuestion,
    stopAll,
    resetForNextQuestion,
    flushBeforeSubmit,
    needsTapToSpeak,
    retrySpeakAfterTap
  }
}
