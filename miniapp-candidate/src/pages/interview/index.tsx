/// <reference path="../../types/trtc-wx-sdk.d.ts" />
import Taro, { getCurrentInstance, useDidHide, useDidShow } from '@tarojs/taro'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Button, Camera, Image, LivePusher, Text, View } from '@tarojs/components'
import type { LivePusherProps } from '@tarojs/components/types/LivePusher'
import TrtcWx from 'trtc-wx-sdk'

import { getApiBase } from '../../config/apiBase'
import { AI_INTERVIEWER_IMG_URL } from '../../config/aiInterviewerImgUrl'
import {
  bindSessionMember,
  fetchInterviewQuestions,
  fetchTrtcCredential,
  startLiveSession,
  submitInterview,
  syncLiveQa,
  syncLiveTranscript,
  syncTrtcRoomSignal,
  type TrtcCredential
} from '../../services/interviewApi'
import { trySendTrtcPusherCustomMessage } from '../../utils/trtcPusherMsg'
import { flowLog, flowLogInfo } from '../../utils/flowLog'
import { playInterviewQuestionTts } from '../../utils/interviewQuestionTts'
import { CandidateProfile, InterviewAnswer, InterviewQuestion, JobInfo } from '../../types/interview'

import './index.scss'

const requirePluginFn = (globalThis as any).requirePlugin as ((name: string) => any) | undefined

type PusherState = Record<string, any> | null

export default function InterviewPage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [job, setJob] = useState<JobInfo | null>(null)
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [index, setIndex] = useState(0)
  /** onStop 固化后的片段列表（最终态） */
  const [transcriptFinalized, setTranscriptFinalized] = useState<string[]>([])
  /** onRecognize 流式中间态，未定稿 */
  const [transcriptStreaming, setTranscriptStreaming] = useState('')
  const transcriptFinalizedRef = useRef<string[]>([])
  transcriptFinalizedRef.current = transcriptFinalized
  const [answers, setAnswers] = useState<InterviewAnswer[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [showAnswerTranscript, setShowAnswerTranscript] = useState(false)
  /** 通话场景顶部状态：读题 / 作答 */
  const [callStatusLine, setCallStatusLine] = useState('正在连接…')
  const [initError, setInitError] = useState('')
  const [cameraError, setCameraError] = useState('')
  /** 已用 TRTC live-pusher 进房（未配置或服务端 503 时为 false，使用原生 Camera） */
  const [trtcActive, setTrtcActive] = useState(false)
  const [pusher, setPusher] = useState<PusherState>(null)

  const transcribingRef = useRef(false)
  transcribingRef.current = transcribing
  const dataInitMarkerRef = useRef('')
  const recordManagerRef = useRef<{ stop?: () => void } | null>(null)
  const trtcRef = useRef<InstanceType<typeof TrtcWx> | null>(null)
  const trtcErrorHookedRef = useRef(false)
  const trtcImHookedRef = useRef(false)
  const trtcEnteredSidRef = useRef('')
  const visibleRef = useRef(false)
  const questionCountRef = useRef(0)
  questionCountRef.current = questions.length
  const questionListRef = useRef<InterviewQuestion[]>([])
  questionListRef.current = questions
  const questionIndexRef = useRef(0)
  questionIndexRef.current = index
  const loadingRef = useRef(false)
  loadingRef.current = loading
  /** 切题 force 重启过程中抑制 onStop 自动重启，避免重复启动 */
  const suppressAutoRestartRef = useRef(false)
  /** 切题时 stop 后须在 onStop 里再 start，否则会报 please wait recognition finished */
  const pendingRestartSidRef = useRef<string | null>(null)
  const forceRestartFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answerPhaseGateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 切题时丢弃上题最后一个 onStop 尾包，避免写回到下一题 */
  const dropNextOnStopResultRef = useRef(false)
  /** 切题或首题：转写 stop 完成后先播题目 TTS 再 openRecognition */
  const pendingTtsAfterStopRef = useRef<string | null>(null)
  /** 读题播报进行中时，强制忽略转写结果 */
  const questionTtsPlayingRef = useRef(false)
  /** 读题结束后的短窗口，忽略可能被拾取到的播报残音 */
  const ignoreRecognizeBeforeTsRef = useRef(0)
  /**
   * 仅在为「当前题作答」启动 RecordRecognition 后为 true。
   * 拉题、建会话、读题 TTS 期间均为 false，避免加载的几秒内或播报被写入回答框。
   */
  const answerTranscriptOpenRef = useRef(false)
  const questionInnerAudioRef = useRef<ReturnType<typeof Taro.createInnerAudioContext> | null>(null)
  /** WechatSI onRecognize 触发极频繁，直接打 /transcript 会像「一字一请求」；防抖后合并上报 */
  const TRANSCRIPT_REMOTE_DEBOUNCE_MS = 600
  const transcriptRemoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestLiveTranscriptSyncRef = useRef('')
  const cancelTranscriptRemoteDebounce = useCallback(() => {
    if (transcriptRemoteTimerRef.current) {
      clearTimeout(transcriptRemoteTimerRef.current)
      transcriptRemoteTimerRef.current = null
    }
  }, [])
  const pushTranscriptRemoteNow = useCallback((sidInner: string, fullText: string) => {
    const t = String(fullText || '').trim()
    if (!t) return
    syncLiveTranscript(sidInner, t)
    void syncTrtcRoomSignal(sidInner, t, 'subtitle')
    trySendTrtcPusherCustomMessage(trtcRef.current, t)
  }, [])
  const scheduleTranscriptRemote = useCallback(
    (sidInner: string) => {
      cancelTranscriptRemoteDebounce()
      transcriptRemoteTimerRef.current = setTimeout(() => {
        transcriptRemoteTimerRef.current = null
        pushTranscriptRemoteNow(sidInner, latestLiveTranscriptSyncRef.current)
      }, TRANSCRIPT_REMOTE_DEBOUNCE_MS)
    },
    [cancelTranscriptRemoteDebounce, pushTranscriptRemoteNow]
  )
  const closeAnswerTranscriptDisplay = useCallback(() => {
    answerTranscriptOpenRef.current = false
    setShowAnswerTranscript(false)
    if (answerPhaseGateTimerRef.current) {
      clearTimeout(answerPhaseGateTimerRef.current)
      answerPhaseGateTimerRef.current = null
    }
  }, [])

  const stopSegmentedAsr = useCallback(() => {
    cancelTranscriptRemoteDebounce()
    pendingRestartSidRef.current = null
    answerTranscriptOpenRef.current = false
    if (answerPhaseGateTimerRef.current) {
      clearTimeout(answerPhaseGateTimerRef.current)
      answerPhaseGateTimerRef.current = null
    }
    if (forceRestartFallbackTimerRef.current) {
      clearTimeout(forceRestartFallbackTimerRef.current)
      forceRestartFallbackTimerRef.current = null
    }
    try {
      recordManagerRef.current?.stop?.()
    } catch {
      /* ignore */
    }
  }, [cancelTranscriptRemoteDebounce])

  const syncPusherFromTrtc = useCallback(() => {
    const trtc = trtcRef.current
    if (!trtc) return
    setPusher({ ...trtc.getPusherAttributes() })
  }, [])

  const handlePusherStateChange = useCallback(
    (e: any) => {
      trtcRef.current?.pusherEventHandler(e)
      syncPusherFromTrtc()
    },
    [syncPusherFromTrtc]
  )

  const handlePusherNetStatus = useCallback(
    (e: any) => {
      trtcRef.current?.pusherNetStatusHandler(e)
      syncPusherFromTrtc()
    },
    [syncPusherFromTrtc]
  )

  const handlePusherError = useCallback(
    (e: any) => {
      trtcRef.current?.pusherErrorHandler(e)
      syncPusherFromTrtc()
    },
    [syncPusherFromTrtc]
  )

  const handlePusherBgmStart = useCallback((e: any) => {
    trtcRef.current?.pusherBGMStartHandler(e)
  }, [])

  const handlePusherBgmProgress = useCallback((e: any) => {
    trtcRef.current?.pusherBGMProgressHandler(e)
  }, [])

  const handlePusherBgmComplete = useCallback((e: any) => {
    trtcRef.current?.pusherBGMCompleteHandler(e)
  }, [])

  const handlePusherAudioVolume = useCallback(
    (e: any) => {
      trtcRef.current?.pusherAudioVolumeNotify(e)
      syncPusherFromTrtc()
    },
    [syncPusherFromTrtc]
  )

  const ensureTrtc = useCallback(() => {
    if (trtcRef.current) return trtcRef.current
    const page = getCurrentInstance()?.page as any
    if (!page) return null
    const trtc = new TrtcWx(page)
    trtcRef.current = trtc
    if (!trtcErrorHookedRef.current) {
      trtc.on(trtc.EVENT.ERROR, () => {
        try {
          trtc.exitRoom()
        } catch {
          /* ignore */
        }
        trtcEnteredSidRef.current = ''
        setTrtcActive(false)
        setPusher(null)
        setCameraError('实时音视频异常，已改用本机相机预览')
      })
      trtcErrorHookedRef.current = true
    }
    if (!trtcImHookedRef.current) {
      trtc.on(trtc.EVENT.IM_MESSAGE_RECEIVED, (evt: unknown) => {
        const wrap = evt as { data?: { data?: string } }
        const raw = wrap?.data?.data
        const text = typeof raw === 'string' ? raw : raw != null ? String(raw) : ''
        const t = text.trim()
        if (t) flowLogInfo('TRTC 房间消息', t.slice(0, 120))
      })
      trtcImHookedRef.current = true
    }
    trtc.createPusher({})
    return trtc
  }, [])

  const tryEnterTrtc = useCallback(
    async (sid: string, userKey: string) => {
      if (!sid || !userKey) {
        flowLog('面试页 TRTC 前置参数', false, `sid=${sid ? 'ok' : 'empty'} userKey=${userKey ? 'ok' : 'empty'}`)
        return
      }
      if (trtcEnteredSidRef.current === sid) {
        flowLogInfo('面试页', 'TRTC 已在当前 session 进房，跳过重复 enterRoom')
        return
      }
      if (!getApiBase()) {
        flowLog('面试页 TRTC 前置参数', false, 'API_BASE 为空')
        return
      }
      try {
        let cred: TrtcCredential | null = null
        const cachedSid = (Taro.getStorageSync('session_id') as string) || ''
        const stored = Taro.getStorageSync('trtc_credential') as TrtcCredential | undefined
        if (stored?.sdkAppId && stored.userSig && cachedSid === sid) {
          flowLogInfo('面试页', 'TRTC 使用本地缓存凭证')
          cred = stored
        }
        if (!cred) {
          flowLogInfo('面试页', 'TRTC 请求后端凭证 /candidate/trtc/credential')
          cred = await fetchTrtcCredential({ sessionId: sid, userId: userKey })
        }
        if (!cred) {
          flowLog('面试页 TRTC 凭证', false, '服务端返回空（常见：TRTC 未配置，接口 503）')
          return
        }
        const trtc = ensureTrtc()
        if (!trtc) {
          flowLog('面试页 TRTC 初始化', false, '当前页面上下文不可用')
          return
        }
        const attrs = trtc.enterRoom({
          sdkAppID: cred.sdkAppId,
          userID: cred.userId,
          userSig: cred.userSig,
          roomID: cred.roomId,
          /** 语音转写走 WechatSI，TRTC 只上推视频，避免与插件抢麦 */
          enableMic: false,
          enableCamera: true
        })
        setPusher({ ...attrs })
        trtc.getPusherInstance()?.start?.({})
        trtcEnteredSidRef.current = sid
        setTrtcActive(true)
        setCameraError('')
        flowLog('面试页 TRTC 进房', true, sid)
      } catch {
        flowLog('面试页 TRTC 进房', false, '未配置或凭证失败，使用 Camera')
      }
    },
    [ensureTrtc]
  )

  useDidHide(() => {
    visibleRef.current = false
    closeAnswerTranscriptDisplay()
    pendingRestartSidRef.current = null
    pendingTtsAfterStopRef.current = null
    if (forceRestartFallbackTimerRef.current) {
      clearTimeout(forceRestartFallbackTimerRef.current)
      forceRestartFallbackTimerRef.current = null
    }
    try {
      questionInnerAudioRef.current?.stop()
      questionInnerAudioRef.current?.destroy()
    } catch {
      /* ignore */
    }
    questionInnerAudioRef.current = null
    stopSegmentedAsr()
    const trtc = trtcRef.current
    if (trtc && trtcEnteredSidRef.current) {
      try {
        trtc.exitRoom()
      } catch {
        /* ignore */
      }
      trtcEnteredSidRef.current = ''
      setTrtcActive(false)
      setPusher(null)
    }
  })

  /** 微信同声传译插件实时转写；force 时仅 stop，须在 onStop 后再 start（否则插件报 please wait recognition finished） */
  const startWechatSiTranscribe = useCallback((sid: string, force = false) => {
    if (!sid) return
    if (!force && transcribingRef.current) return

    const clearForceRestartTimer = () => {
      if (forceRestartFallbackTimerRef.current) {
        clearTimeout(forceRestartFallbackTimerRef.current)
        forceRestartFallbackTimerRef.current = null
      }
    }

    const openRecognition = (sidInner: string) => {
      const normalizeText = (v: string) => String(v || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
      const shouldDropQuestionEcho = (raw: string) => {
        const t = normalizeText(raw)
        if (!t || t.length < 6) return false
        const q = normalizeText(String(questionListRef.current[questionIndexRef.current]?.text || ''))
        if (!q || q.length < 6) return false
        if (q.includes(t)) return true
        if (t.length > 20 && t.includes(q.slice(0, 20))) return true
        return false
      }
      /** 将本句定稿写入历史，并同步整题累计文本 */
      const flushUtteranceToHistory = (utterance: string) => {
        const t = utterance.trim()
        if (!t) {
          setTranscriptStreaming('')
          return
        }
        cancelTranscriptRemoteDebounce()
        setTranscriptFinalized((prev) => {
          const next = [...prev, t]
          const full = next.join('')
          latestLiveTranscriptSyncRef.current = full
          pushTranscriptRemoteNow(sidInner, full)
          return next
        })
        setTranscriptStreaming('')
      }

      try {
        if (!requirePluginFn) throw new Error('plugin api unavailable')
        const plugin = requirePluginFn('WechatSI')
        const manager = plugin.getRecordRecognitionManager()
        recordManagerRef.current = manager
        closeAnswerTranscriptDisplay()
        if (answerPhaseGateTimerRef.current) {
          clearTimeout(answerPhaseGateTimerRef.current)
          answerPhaseGateTimerRef.current = null
        }
        flowLogInfo('WechatSI', 'recordRecognitionManager 已创建，开始录音')
        manager.onRecognize = (res: { result?: string }) => {
          const text = res?.result || ''
          if (questionTtsPlayingRef.current) {
            flowLogInfo('WechatSI onRecognize', 'TTS 播放中，丢弃转写结果')
            return
          }
          if (Date.now() < ignoreRecognizeBeforeTsRef.current) return
          if (!answerTranscriptOpenRef.current) return
          if (shouldDropQuestionEcho(text)) {
            flowLogInfo('WechatSI onRecognize', '命中题目回声过滤')
            return
          }
          if (!text) {
            flowLogInfo('WechatSI onRecognize', '收到空文本')
            return
          }
          flowLog('WechatSI onRecognize', true, `len=${text.length}`)
          setTranscriptStreaming(text)
          const fullLive = transcriptFinalizedRef.current.join('') + text
          latestLiveTranscriptSyncRef.current = fullLive
          scheduleTranscriptRemote(sidInner)
        }
        manager.onStop = (res: { result?: string }) => {
          if (recordManagerRef.current !== manager) {
            flowLogInfo('WechatSI', '忽略非当前 RecordRecognition 实例的 onStop')
            return
          }
          const text = res?.result || ''
          if (questionTtsPlayingRef.current) {
            flowLogInfo('WechatSI onStop', 'TTS 播放中 onStop，忽略尾包')
            setTranscriptStreaming('')
            setTranscribing(false)
            return
          }
          if (pendingRestartSidRef.current) {
            clearForceRestartTimer()
            pendingRestartSidRef.current = null
            recordManagerRef.current = null
            if (dropNextOnStopResultRef.current) {
              dropNextOnStopResultRef.current = false
              flowLogInfo('WechatSI', '切题后丢弃上一题 onStop 尾包')
              setTranscriptStreaming('')
            } else if (
              text.trim() &&
              answerTranscriptOpenRef.current &&
              !questionTtsPlayingRef.current &&
              Date.now() >= ignoreRecognizeBeforeTsRef.current &&
              !shouldDropQuestionEcho(text)
            ) {
              flowLog('WechatSI onStop', true, `len=${text.length}`)
              flushUtteranceToHistory(text)
            } else {
              flowLog('WechatSI onStop', false, '忽略空文本或读题期尾包')
              setTranscriptStreaming('')
            }
            setTranscribing(false)
            suppressAutoRestartRef.current = false
            flowLogInfo('WechatSI', '切题 onStop 后读题或重启转写')
            resumeAfterStop(sidInner)
            return
          }

          recordManagerRef.current = null
          if (
            text.trim() &&
            answerTranscriptOpenRef.current &&
            !questionTtsPlayingRef.current &&
            Date.now() >= ignoreRecognizeBeforeTsRef.current &&
            !shouldDropQuestionEcho(text)
          ) {
            flowLog('WechatSI onStop', true, `len=${text.length}`)
            flushUtteranceToHistory(text)
          } else {
            flowLog('WechatSI onStop', false, '忽略空文本或读题期尾包')
            setTranscriptStreaming('')
          }
          setTranscribing(false)
          const canAutoRestart =
            visibleRef.current &&
            !loadingRef.current &&
            !suppressAutoRestartRef.current &&
            questionCountRef.current > 0 &&
            questionIndexRef.current < questionCountRef.current - 1
          if (canAutoRestart) {
            setTimeout(() => {
              if (
                visibleRef.current &&
                !loadingRef.current &&
                !transcribingRef.current &&
                questionCountRef.current > 0 &&
                questionIndexRef.current < questionCountRef.current - 1
              ) {
                flowLogInfo('WechatSI', 'onStop 后自动重启')
                openRecognition(sidInner)
              }
            }, 220)
          }
        }
        manager.onError = (err: unknown) => {
          if (answerPhaseGateTimerRef.current) {
            clearTimeout(answerPhaseGateTimerRef.current)
            answerPhaseGateTimerRef.current = null
          }
          answerTranscriptOpenRef.current = false
          recordManagerRef.current = null
          setTranscribing(false)
          setTranscriptStreaming('')
          const msg = (() => {
            try {
              return JSON.stringify(err)
            } catch {
              return String(err || '')
            }
          })()
          flowLog('WechatSI onError', false, msg || 'unknown')
          const friendly =
            /please wait recognition finished/i.test(msg) || /recognition finished/i.test(msg)
            ? '上一段识别尚未结束，请稍候再试；若刚切换题目，请稍等一秒。'
            : '转写不可用：请检查麦克风权限、插件配置，或改手动输入'
          flowLogInfo('WechatSI', friendly)
        }
        const startOpts = { lang: 'zh_CN', duration: 60000 }
        manager.start(startOpts)
        // 极短冷却：读题结束后主要靠 questionTtsPlayingRef + 短 ignore 窗防回声，避免“慢半拍”。
        const gateDelayMs = 220
        answerTranscriptOpenRef.current = false
        answerPhaseGateTimerRef.current = setTimeout(() => {
          answerPhaseGateTimerRef.current = null
          cancelTranscriptRemoteDebounce()
          setTranscriptFinalized([])
          setTranscriptStreaming('')
          latestLiveTranscriptSyncRef.current = ''
          answerTranscriptOpenRef.current = true
          setShowAnswerTranscript(true)
        }, gateDelayMs)
        setTranscribing(true)
        suppressAutoRestartRef.current = false
        flowLog('WechatSI start', true, `lang=${startOpts.lang} duration=${startOpts.duration}`)
      } catch (e) {
        answerTranscriptOpenRef.current = false
        suppressAutoRestartRef.current = false
        flowLog('WechatSI start', false, e instanceof Error ? e.message : 'plugin unavailable')
      }
    }

    /** 读题结束：若识别已在跑则只重新“开门”，避免重复 start；否则走 openRecognition。 */
    const resumeAnswerAfterQuestionTts = (sidInner: string) => {
      if (!visibleRef.current) return
      setCallStatusLine('请口述您的回答')
      if (!transcribingRef.current) {
        openRecognition(sidInner)
        return
      }
      if (answerPhaseGateTimerRef.current) {
        clearTimeout(answerPhaseGateTimerRef.current)
        answerPhaseGateTimerRef.current = null
      }
      answerTranscriptOpenRef.current = true
      setShowAnswerTranscript(true)
    }

    const playTtsThenResume = (sidInner: string, ttsRaw: string) => {
      if (!requirePluginFn) {
        questionTtsPlayingRef.current = false
        setCallStatusLine('请口述您的回答')
        if (!transcribingRef.current) openRecognition(sidInner)
        else resumeAnswerAfterQuestionTts(sidInner)
        return
      }
      questionTtsPlayingRef.current = true
      setCallStatusLine('AI 正在读题...')
      closeAnswerTranscriptDisplay()
      const ttsText = String(ttsRaw || '').trim()
      const ttsStartAt = Date.now()
      // 最短屏蔽时长：防止 InnerAudio onEnded 过早触发导致 questionTtsPlaying 提前关闭、读题声进框。
      const minTtsCoverMs = Math.max(4200, Math.min(24000, ttsText.length * 200 + 2400))
      ignoreRecognizeBeforeTsRef.current = ttsStartAt + minTtsCoverMs
      playInterviewQuestionTts(
        ttsText,
        {
          requirePlugin: (name) => requirePluginFn(name),
          audioRef: questionInnerAudioRef,
          onStatus: setCallStatusLine
        },
        () => {
          const elapsed = Date.now() - ttsStartAt
          const holdMs = Math.max(0, minTtsCoverMs - elapsed)
          const releaseTtsAndResume = () => {
            questionTtsPlayingRef.current = false
            ignoreRecognizeBeforeTsRef.current = Date.now() + 900
            setTimeout(() => resumeAnswerAfterQuestionTts(sidInner), 30)
          }
          if (holdMs <= 0) {
            releaseTtsAndResume()
          } else {
            setTimeout(releaseTtsAndResume, holdMs)
          }
        }
      )
    }

    const resumeAfterStop = (sidInner: string) => {
      const t = pendingTtsAfterStopRef.current
      pendingTtsAfterStopRef.current = null
      if (t != null && String(t).trim().length > 0) {
        flowLog('面试读题 TTS', true, `queued len=${String(t).length}`)
        playTtsThenResume(sidInner, String(t))
      } else {
        closeAnswerTranscriptDisplay()
        setCallStatusLine('请口述您的回答')
        openRecognition(sidInner)
      }
    }

    if (force) {
      suppressAutoRestartRef.current = true
      const mgr = recordManagerRef.current
      if (mgr) {
        dropNextOnStopResultRef.current = true
        pendingRestartSidRef.current = sid
        clearForceRestartTimer()
        forceRestartFallbackTimerRef.current = setTimeout(() => {
          forceRestartFallbackTimerRef.current = null
          if (pendingRestartSidRef.current === sid) {
            flowLogInfo('WechatSI', '切题 stop 未收到 onStop，兜底启动')
            pendingRestartSidRef.current = null
            dropNextOnStopResultRef.current = false
            resumeAfterStop(sid)
          }
        }, 1800)
        try {
          mgr.stop?.()
        } catch {
          clearForceRestartTimer()
          pendingRestartSidRef.current = null
          dropNextOnStopResultRef.current = false
          resumeAfterStop(sid)
        }
        return
      }
    }

    resumeAfterStop(sid)
  }, [cancelTranscriptRemoteDebounce, scheduleTranscriptRemote, pushTranscriptRemoteNow])

  useDidShow(() => {
    visibleRef.current = true
    void (async () => {
      const p = Taro.getStorageSync('candidate_profile') as CandidateProfile | undefined
      const j = Taro.getStorageSync('candidate_job') as JobInfo | undefined
      if (!p?.name || !j?.id) {
        Taro.redirectTo({ url: '/pages/entry/index' })
        return
      }
      setProfile(p)
      setJob(j)

      const cachedSid = (Taro.getStorageSync('session_id') as string) || ''
      const sid = cachedSid || `${j.id}-${p.openid || p.phone || 'unknown'}`
      const dataMarker = `${j.id}\t${sid}\t${p.openid || ''}\t${p.phone || ''}`
      const userKey = String(p.openid || p.phone || sid).trim()

      if (dataInitMarkerRef.current !== dataMarker) {
        dataInitMarkerRef.current = dataMarker
        setInitError('')
        closeAnswerTranscriptDisplay()
        try {
          const list = await fetchInterviewQuestions(j.id, p.name)
          const cleaned = list.filter((q) => q && String(q.text || '').trim())
          if (!cleaned.length) throw new Error('empty questions')
          flowLog('AI 题目生成', true, `${cleaned.length} 题`)
          flowLogInfo('AI 首题', cleaned[0]?.text?.slice(0, 40) || '')
          setQuestions(cleaned)
          setTranscriptFinalized([])
          setTranscriptStreaming('')
          setSessionId(sid)
          await startLiveSession({
            sessionId: sid,
            jobId: j.id,
            candidateName: p.name,
            candidateOpenId: p.openid,
            questions: cleaned
          })
          if (p.openid) {
            await bindSessionMember({ sessionId: sid, role: 'candidate', openid: p.openid })
          }
          flowLog('面试页 拉题+startLiveSession', true, `${cleaned.length} 题`)
          if (!transcribingRef.current) {
            flowLogInfo('面试页', '首题：先停转写队列再语音读题')
            pendingTtsAfterStopRef.current = cleaned[0]?.text ?? ''
            setCallStatusLine('准备语音读题…')
            void startWechatSiTranscribe(sid, true)
          }
        } catch (e) {
          dataInitMarkerRef.current = ''
          flowLog('AI 题目生成', false, e instanceof Error ? e.message : '未知错误')
          flowLog('面试页 拉题或建会话', false, '见网络或后端')
          setInitError('题目或会话初始化失败，请检查网络与后端后重试')
          Taro.showToast({ title: '题目或会话加载失败', icon: 'none' })
        }
      } else {
        setSessionId(sid)
        if (!transcribingRef.current) {
          closeAnswerTranscriptDisplay()
          const currentText = String((questions[questionIndexRef.current]?.text ?? '') || '').trim()
          flowLogInfo('面试页', '回到面试页：先停转写再读题')
          pendingTtsAfterStopRef.current = currentText
          setCallStatusLine(currentText ? '准备语音读题…' : '请口述您的回答')
          void startWechatSiTranscribe(sid, true)
        }
      }

      flowLogInfo('面试页', '尝试 TRTC 进房')
      void tryEnterTrtc(sid, userKey)
    })()
  })

  const current = questions[index]
  const isLast = questions.length > 0 && index === questions.length - 1
  const composedAnswer = useMemo(
    () => (transcriptFinalized.join('') + transcriptStreaming).trim(),
    [transcriptFinalized, transcriptStreaming]
  )
  const canNext = useMemo(() => composedAnswer.length >= 2, [composedAnswer])
  const speakingHighlight = transcribing && transcriptStreaming.length > 0

  const handleNext = async () => {
    if (!current || !canNext || !profile || !job) return

    cancelTranscriptRemoteDebounce()
    pushTranscriptRemoteNow(sessionId, composedAnswer)

    const currentQa = { questionId: current.id, question: current.text, answer: composedAnswer }
    const nextAnswers = [...answers, currentQa]
    setAnswers(nextAnswers)
    await syncLiveQa({ sessionId, ...currentQa })
    setTranscriptFinalized([])
    setTranscriptStreaming('')

    if (!isLast) {
      const nextIdx = index + 1
      closeAnswerTranscriptDisplay()
      pendingTtsAfterStopRef.current = questions[nextIdx]?.text ?? ''
      setIndex(nextIdx)
      void startWechatSiTranscribe(sessionId, true)
      return
    }

    try {
      setLoading(true)
      const result = await submitInterview(profile, job.id, nextAnswers, sessionId)
      Taro.setStorageSync('interview_result', result)
      Taro.redirectTo({ url: '/pages/result/index' })
    } catch (e) {
      Taro.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const reloadPage = () => {
    Taro.reLaunch({ url: '/pages/interview/index' })
  }

  const showTrtcPusher = trtcActive && pusher && String(pusher.url || '').length > 0

  return (
    <View className='safe-container interview-page'>
      <View className='interview-hero'>
        <View className='interviewer-stage'>
          <View className='interviewer-bg' />
          <View className='interviewer-figure-layer'>
            <View className='interviewer-avatar-stack'>
              <View className='interviewer-circle-cluster'>
                <View className='interviewer-orbit interviewer-orbit--b' aria-hidden />
                <View className='interviewer-orbit interviewer-orbit--a' aria-hidden />
                <View className='interviewer-circle-frame'>
                  <Image
                    className='interviewer-circle-img'
                    src={AI_INTERVIEWER_IMG_URL}
                    mode='aspectFill'
                  />
                  <View className='interviewer-circle-badge'>
                    <Text className='interviewer-circle-badge-text'>AI 面试官</Text>
                  </View>
                </View>
              </View>
              <View className='interviewer-name-dots'>
                <View className='interviewer-name-dot interviewer-name-dot--active' />
                <View className='interviewer-name-dot' />
              </View>
            </View>
          </View>
          <View className={`pip-camera-wrap${speakingHighlight ? ' pip-camera-wrap--active' : ''}`}>
            {showTrtcPusher ? (
              <LivePusher
                className='pip-camera'
                url={pusher.url}
                mode='RTC'
                autopush={Boolean(pusher.autopush)}
                enableCamera={pusher.enableCamera !== false}
                enableMic={false}
                muted
                enableAgc={Boolean(pusher.enableAgc)}
                enableAns={Boolean(pusher.enableAns)}
                autoFocus={pusher.enableAutoFocus !== false}
                zoom={Boolean(pusher.enableZoom)}
                minBitrate={pusher.minBitrate}
                maxBitrate={pusher.maxBitrate}
                videoWidth={pusher.videoWidth}
                videoHeight={pusher.videoHeight}
                beauty={pusher.beautyLevel ?? 0}
                whiteness={pusher.whitenessLevel ?? 0}
                orientation={pusher.videoOrientation || 'vertical'}
                aspect={pusher.videoAspect === '3:4' ? '3:4' : '9:16'}
                devicePosition={pusher.frontCamera || 'front'}
                remoteMirror={Boolean(pusher.enableRemoteMirror)}
                localMirror={pusher.localMirror || 'auto'}
                backgroundMute={Boolean(pusher.enableBackgroundMute)}
                audioQuality={pusher.audioQuality || 'high'}
                audioVolumeType={pusher.audioVolumeType || 'voicecall'}
                audioReverbType={
                  (Number(pusher.audioReverbType) || 0) as keyof LivePusherProps.AudioReverbType
                }
                waitingImage={pusher.waitingImage}
                beautyStyle={pusher.beautyStyle || 'smooth'}
                filter={pusher.filter || 'standard'}
                onStateChange={handlePusherStateChange}
                onNetStatus={handlePusherNetStatus}
                onError={handlePusherError}
                onBgmStart={handlePusherBgmStart}
                onBgmProgress={handlePusherBgmProgress}
                onBgmComplete={handlePusherBgmComplete}
                onAudioVolumeNotify={handlePusherAudioVolume}
              />
            ) : (
              <Camera
                className='pip-camera'
                mode='normal'
                devicePosition='front'
                flash='off'
                onError={() => {
                  setCameraError('无法使用摄像头，请在系统设置或小程序权限中允许相机，或稍后重试。')
                }}
                onInitDone={() => setCameraError('')}
              />
            )}
            <View className='pip-name-chip'>
              <Text className='pip-label'>我</Text>
            </View>
          </View>
        </View>
      </View>

      <View className='card'>
        <View className='interview-job-block'>
          <Text className='call-status-line'>{callStatusLine}</Text>
          <Text className='job-title'>{job?.title || '岗位面试'}</Text>
          <Text className='progress'>
            第 {questions.length ? Math.min(index + 1, questions.length) : 0} 题 / 共 {questions.length || '--'} 题
          </Text>
          {initError ? (
            <View className='init-error-box'>
              <Text className='init-error-text'>{initError}</Text>
              <Button className='secondary-btn' onClick={reloadPage}>
                重新加载本页
              </Button>
            </View>
          ) : null}
        </View>
        {cameraError ? <Text className='camera-error-text'>{cameraError}</Text> : null}
        <View className='question-box'>
          <Text className='question-text'>{current?.text || (questions.length ? '题目索引异常' : '正在加载题目…')}</Text>
          <View className='answer-box'>
            <Text className='answer-label'>实时转写回答</Text>
            <View className='transcript-composer'>
              {!showAnswerTranscript ? <Text className='answer-placeholder'>读题中，转写内容暂不显示</Text> : null}
              {showAnswerTranscript && transcriptFinalized.length === 0 && !transcriptStreaming && !transcribing ? (
                <Text className='answer-placeholder'>请直接口述作答，转写文本将显示在这里</Text>
              ) : null}
              {showAnswerTranscript &&
                transcriptFinalized.map((line, i) => (
                <View key={`fin-${i}`} className='transcript-final-row'>
                  <Text className='transcript-final-text'>{line}</Text>
                </View>
                ))}
              {showAnswerTranscript && (transcribing || transcriptStreaming.length > 0) ? (
                <View className='transcript-stream-row'>
                  <Text className='transcript-stream-text'>{transcriptStreaming}</Text>
                  {transcribing ? <Text className='transcript-caret'>▍</Text> : null}
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <Button
          className='primary-btn'
          loading={loading}
          disabled={!canNext || loading || !current}
          onClick={() => void handleNext()}
        >
          {isLast ? '提交面试' : '下一题'}
        </Button>
        <Text className='transcript-tip'>本服务为AI生成内容，结果仅供参考</Text>
      </View>
    </View>
  )
}
