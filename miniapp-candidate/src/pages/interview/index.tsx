/// <reference path="../../types/trtc-wx-sdk.d.ts" />
import Taro, { getCurrentInstance, useDidHide, useDidShow, useUnload } from '@tarojs/taro'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Button, Camera, LivePusher, Text, Video, View } from '@tarojs/components'
import type { LivePusherProps } from '@tarojs/components/types/LivePusher'
import TrtcWx from 'trtc-wx-sdk'

import { getApiBase } from '../../config/apiBase'
import { AI_INTERVIEWER_IMG_URL } from '../../config/aiInterviewerImgUrl'
import {
  getOpeningVideoUrl,
  getUmmVideoUrl,
  OPENING_VIDEO_CACHE_KEY,
  UMM_VIDEO_CACHE_KEY
} from '../../config/digitalHumanVideo'
import {
  bindSessionMember,
  buildInterviewQuestionsCacheKey,
  DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG,
  ensureInterviewQuestionsRest,
  fetchInterviewFollowUpConfig,
  fetchInterviewQuestionsOrPrefetched,
  fetchPreparedFollowUp,
  fetchTrtcCredential,
  startLiveSession,
  submitInterview,
  syncLiveQa,
  syncLiveTranscript,
  syncTrtcRoomSignal,
  type InterviewFollowUpConfig,
  type TrtcCredential
} from '../../services/interviewApi'
import { trySendTrtcPusherCustomMessage } from '../../utils/trtcPusherMsg'
import { flowLog, flowLogInfo } from '../../utils/flowLog'
import { playInterviewQuestionTts, prefetchInterviewQuestionTtsPath } from '../../utils/interviewQuestionTts'
import { consumePrefetchedFirstQuestionTts } from '../../utils/interviewWarmup'
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
  const firstListenGateRef = useRef({ sid: '', text: '' })
  /** 首题 textToSpeech 预拉路径；用户点击里同步 play，规避微信对异步回调内 play 的限制 */
  const firstQuestionPrefetchedFileRef = useRef('')
  const pendingUsePrefetchedFirstTtsRef = useRef(false)
  const firstQuestionPrefetchUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstQuestionTtsPrefetchingRef = useRef(false)
  /** 首题自动播放失败后，等待用户任意点击重试一次 */
  const firstQuestionNeedsTapRetryRef = useRef(false)
  const [cameraError, setCameraError] = useState('')
  /** 已用 TRTC live-pusher 进房（未配置或服务端 503 时为 false，使用原生 Camera） */
  const [trtcActive, setTrtcActive] = useState(false)
  const [pusher, setPusher] = useState<PusherState>(null)

  /**
   * 数字人面试官状态：
   * - idle：读题前 / 读题结束后等待作答，静态 PNG 呼吸，不播视频。
   * - speaking：系统播报（AI 读题）时循环播放「开场」视频。
   * - listening：候选人已开口作答时播放「嗯」视频。
   */
  const [dhMode, setDhMode] = useState<'idle' | 'speaking' | 'listening'>('idle')
  const dhModeRef = useRef<'idle' | 'speaking' | 'listening'>('idle')
  dhModeRef.current = dhMode
  const ummLoopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 作答视频「嗯」播完后延迟多少毫秒再循环 */
  const UMM_LOOP_DELAY_MS = 3000
  const OPENING_VIDEO_ID = 'dhOpeningVideo'
  const UMM_VIDEO_ID = 'dhUmmVideo'
  /** 优先用邀请码/候场页预下载的本地缓存路径，没有再回退到 API URL */
  const [openingVideoSrc, setOpeningVideoSrc] = useState<string>(() => {
    try {
      const cached = Taro.getStorageSync(OPENING_VIDEO_CACHE_KEY) as string
      if (cached) return cached
    } catch {
      /* ignore */
    }
    return getOpeningVideoUrl()
  })
  const [ummVideoSrc, setUmmVideoSrc] = useState<string>(() => {
    try {
      const cached = Taro.getStorageSync(UMM_VIDEO_CACHE_KEY) as string
      if (cached) return cached
    } catch {
      /* ignore */
    }
    return getUmmVideoUrl()
  })
  /**
   * 数字人视频加载/缓冲状态：PC 端微信小程序对本地缓存路径或大 mp4 首帧加载较慢，
   * 未就绪/缓冲时显示 loading 遮罩，避免黑屏或卡住没反应。
   */
  const [openingVideoReady, setOpeningVideoReady] = useState(false)
  const [ummVideoReady, setUmmVideoReady] = useState(false)
  const [openingVideoBuffering, setOpeningVideoBuffering] = useState(false)
  const [ummVideoBuffering, setUmmVideoBuffering] = useState(false)
  /** 本地缓存路径在 PC 端可能无法播放，onError 时回退到 OSS 网络地址，仅回退一次 */
  const openingFellBackRef = useRef(false)
  const ummFellBackRef = useRef(false)

  const handleOpeningVideoError = useCallback(() => {
    if (openingFellBackRef.current) return
    const net = getOpeningVideoUrl()
    openingFellBackRef.current = true
    setOpeningVideoReady(false)
    setOpeningVideoSrc((prev) => (prev === net ? prev : net))
  }, [])

  const handleUmmVideoError = useCallback(() => {
    if (ummFellBackRef.current) return
    const net = getUmmVideoUrl()
    ummFellBackRef.current = true
    setUmmVideoReady(false)
    setUmmVideoSrc((prev) => (prev === net ? prev : net))
  }, [])

  const clearUmmLoopTimer = useCallback(() => {
    if (ummLoopTimerRef.current) {
      clearTimeout(ummLoopTimerRef.current)
      ummLoopTimerRef.current = null
    }
  }, [])

  /** 「嗯」视频播放结束：延迟几秒后再从头循环，模拟数字人偶尔点头/轻“嗯”的自然停顿 */
  const handleUmmVideoEnded = useCallback(() => {
    clearUmmLoopTimer()
    ummLoopTimerRef.current = setTimeout(() => {
      ummLoopTimerRef.current = null
      if (dhModeRef.current !== 'listening' || !visibleRef.current) return
      try {
        const ctx = Taro.createVideoContext(UMM_VIDEO_ID)
        ctx?.seek?.(0)
        ctx?.play?.()
      } catch {
        /* ignore */
      }
    }, UMM_LOOP_DELAY_MS)
  }, [clearUmmLoopTimer])

  /**
   * 按当前 dhMode 让对应视频播放、另一个暂停。
   * 小程序原生 video 在 autoplay 失败、或页面切后台再回前台时会停住，
   * 所以统一用 createVideoContext 主动驱动，并在 useDidShow / 模式切换时各调一次。
   */
  const applyDigitalHumanPlayback = useCallback(
    (mode: 'idle' | 'speaking' | 'listening') => {
      let opening: ReturnType<typeof Taro.createVideoContext> | null = null
      let umm: ReturnType<typeof Taro.createVideoContext> | null = null
      try {
        opening = Taro.createVideoContext(OPENING_VIDEO_ID)
      } catch {
        opening = null
      }
      try {
        umm = Taro.createVideoContext(UMM_VIDEO_ID)
      } catch {
        umm = null
      }
      if (mode === 'idle') {
        clearUmmLoopTimer()
        try {
          opening?.pause?.()
          opening?.seek?.(0)
        } catch {
          /* ignore */
        }
        try {
          umm?.pause?.()
          umm?.seek?.(0)
        } catch {
          /* ignore */
        }
        return
      }
      if (mode === 'speaking') {
        clearUmmLoopTimer()
        try {
          umm?.pause?.()
          umm?.seek?.(0)
        } catch {
          /* ignore */
        }
        try {
          opening?.seek?.(0)
          opening?.play?.()
        } catch {
          /* ignore */
        }
      } else {
        try {
          opening?.pause?.()
          opening?.seek?.(0)
        } catch {
          /* ignore */
        }
        try {
          umm?.seek?.(0)
          umm?.play?.()
        } catch {
          /* ignore */
        }
      }
    },
    [clearUmmLoopTimer]
  )

  /** 切换数字人视频模式并立刻驱动原生 video（不等 useEffect），播报结束须马上停「开场」 */
  const setDigitalHumanMode = useCallback(
    (mode: 'idle' | 'speaking' | 'listening') => {
      dhModeRef.current = mode
      setDhMode(mode)
      applyDigitalHumanPlayback(mode)
    },
    [applyDigitalHumanPlayback]
  )

  /** 作答阶段：未开口前保持 PNG，首次检测到转写再切「嗯」MP4 */
  const ummAvatarActivatedRef = useRef(false)

  /** 读题结束 / 等待作答：立刻停开场与嗯视频，回到 PNG */
  const resetAnswerPhaseAvatar = useCallback(() => {
    ummAvatarActivatedRef.current = false
    setDigitalHumanMode('idle')
  }, [setDigitalHumanMode])

  const activateUmmAvatarOnUserSpeech = useCallback(
    (text: string) => {
      const t = String(text || '').trim()
      if (!t || ummAvatarActivatedRef.current) return
      if (questionTtsPlayingRef.current || dhModeRef.current === 'speaking') return
      ummAvatarActivatedRef.current = true
      setDigitalHumanMode('listening')
    },
    [setDigitalHumanMode]
  )

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
  const followUpCountRef = useRef(0)
  const followUpParentIdsRef = useRef<Set<string>>(new Set())
  const followUpConfigRef = useRef<InterviewFollowUpConfig>(DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG)
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
  /** 每次真正进入作答转写的时间；开头一小段最容易夹带读题尾音 */
  const answerRecognitionOpenedAtRef = useRef(0)
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
    const q = questionListRef.current[questionIndexRef.current]
    syncLiveTranscript(sidInner, t, {
      questionId: q?.id || '',
      question: q?.text || ''
    })
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
    pendingTtsAfterStopRef.current = null
    suppressAutoRestartRef.current = false
    dropNextOnStopResultRef.current = false
    answerTranscriptOpenRef.current = false
    if (answerPhaseGateTimerRef.current) {
      clearTimeout(answerPhaseGateTimerRef.current)
      answerPhaseGateTimerRef.current = null
    }
    if (forceRestartFallbackTimerRef.current) {
      clearTimeout(forceRestartFallbackTimerRef.current)
      forceRestartFallbackTimerRef.current = null
    }
    const mgr = recordManagerRef.current
    // 先断开引用，旧实例后续的 onStop 会因实例不匹配被忽略，避免污染下一次转写
    recordManagerRef.current = null
    try {
      mgr?.stop?.()
    } catch {
      /* ignore */
    }
    // 同步复位转写态：离开页面时若不复位，返回页面后 transcribingRef 仍为 true 会导致不再重启转写
    transcribingRef.current = false
    setTranscribing(false)
    setTranscriptStreaming('')
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
    firstQuestionTtsPrefetchingRef.current = false
    firstQuestionPrefetchedFileRef.current = ''
    pendingUsePrefetchedFirstTtsRef.current = false
    firstQuestionNeedsTapRetryRef.current = false
    if (firstQuestionPrefetchUiTimerRef.current) {
      clearTimeout(firstQuestionPrefetchUiTimerRef.current)
      firstQuestionPrefetchUiTimerRef.current = null
    }
    closeAnswerTranscriptDisplay()
    clearUmmLoopTimer()
    ummAvatarActivatedRef.current = false
    setDigitalHumanMode('idle')
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

  /**
   * 页面卸载（reLaunch/刷新本页、跳转销毁页面）时彻底停止录音与退房。
   * 否则 WechatSI 录音识别会被上个页面实例占用，新页面 start 时报
   * “please wait recognition finished”，导致刷新后转写失效。
   */
  useUnload(() => {
    visibleRef.current = false
    clearUmmLoopTimer()
    if (firstQuestionPrefetchUiTimerRef.current) {
      clearTimeout(firstQuestionPrefetchUiTimerRef.current)
      firstQuestionPrefetchUiTimerRef.current = null
    }
    try {
      questionInnerAudioRef.current?.stop()
      questionInnerAudioRef.current?.destroy()
    } catch {
      /* ignore */
    }
    questionInnerAudioRef.current = null
    questionTtsPlayingRef.current = false
    stopSegmentedAsr()
    const trtc = trtcRef.current
    if (trtc && trtcEnteredSidRef.current) {
      try {
        trtc.exitRoom()
      } catch {
        /* ignore */
      }
      trtcEnteredSidRef.current = ''
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

    /**
     * WechatSI 单次 start 最长 duration（默认 60s）到点会 onStop。
     * 同题续录时必须 preserveAccumulated，否则门控里清空 finalized 会导致「答到一分钟字全没了」。
     */
    const openRecognition = (sidInner: string, opts?: { preserveAccumulated?: boolean }) => {
      const preserveAccumulated = Boolean(opts?.preserveAccumulated)
      const normalizeText = (v: string) => String(v || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
      const longestCommonSubstringLen = (a: string, b: string) => {
        if (!a || !b) return 0
        const prev = new Array(b.length + 1).fill(0)
        let best = 0
        for (let i = 1; i <= a.length; i += 1) {
          let lastDiag = 0
          for (let j = 1; j <= b.length; j += 1) {
            const saved = prev[j]
            if (a[i - 1] === b[j - 1]) {
              prev[j] = lastDiag + 1
              if (prev[j] > best) best = prev[j]
            } else {
              prev[j] = 0
            }
            lastDiag = saved
          }
        }
        return best
      }
      const shouldDropQuestionEcho = (raw: string) => {
        const t = normalizeText(raw)
        if (!t || t.length < 6) return false
        const q = normalizeText(String(questionListRef.current[questionIndexRef.current]?.text || ''))
        if (!q || q.length < 6) return false
        const sinceOpen = Date.now() - answerRecognitionOpenedAtRef.current
        if (sinceOpen >= 0 && sinceOpen < 1800) {
          const common = longestCommonSubstringLen(t, q)
          const coverage = common / Math.max(1, Math.min(t.length, q.length))
          if (common >= 8 && coverage >= 0.55) return true
        }
        if (q.includes(t)) return true
        if (t.includes(q)) return true
        if (t.length >= 12 && q.includes(t.slice(0, 12))) return true
        if (t.length >= 12 && q.includes(t.slice(-12))) return true
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
        activateUmmAvatarOnUserSpeech(t)
        cancelTranscriptRemoteDebounce()
        setTranscriptFinalized((prev) => {
          const next = [...prev, t]
          transcriptFinalizedRef.current = next
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
        if (preserveAccumulated) {
          if (answerPhaseGateTimerRef.current) {
            clearTimeout(answerPhaseGateTimerRef.current)
            answerPhaseGateTimerRef.current = null
          }
          answerTranscriptOpenRef.current = false
        } else {
          closeAnswerTranscriptDisplay()
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
          activateUmmAvatarOnUserSpeech(text)
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
          /** 含最后一题：单次录音最长 60s，到点必须续开一段，否则长答会断且无法继续转写 */
          const canAutoRestart =
            visibleRef.current &&
            !loadingRef.current &&
            !suppressAutoRestartRef.current &&
            questionCountRef.current > 0
          if (canAutoRestart) {
            setTimeout(() => {
              if (
                visibleRef.current &&
                !loadingRef.current &&
                !transcribingRef.current &&
                questionCountRef.current > 0
              ) {
                flowLogInfo('WechatSI', 'onStop 后同题续录（保留已转写）')
                openRecognition(sidInner, { preserveAccumulated: true })
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
          if (!preserveAccumulated) {
            setTranscriptFinalized([])
            latestLiveTranscriptSyncRef.current = ''
          } else {
            latestLiveTranscriptSyncRef.current = transcriptFinalizedRef.current.join('')
          }
          setTranscriptStreaming('')
          answerRecognitionOpenedAtRef.current = Date.now()
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

    /** 读题结束：强制重开一段识别，避免 manager 偶发失活导致有声无字。 */
    const resumeAnswerAfterQuestionTts = (sidInner: string) => {
      if (!visibleRef.current) return
      setCallStatusLine('请口述您的回答')
      const mgr = recordManagerRef.current
      if (mgr) {
        try {
          mgr.stop?.()
        } catch {
          /* ignore */
        }
      }
      recordManagerRef.current = null
      setTranscribing(false)
      if (answerPhaseGateTimerRef.current) {
        clearTimeout(answerPhaseGateTimerRef.current)
        answerPhaseGateTimerRef.current = null
      }
      answerTranscriptOpenRef.current = true
      setShowAnswerTranscript(true)
      setTimeout(() => openRecognition(sidInner), 120)
    }

    const playTtsThenResume = (sidInner: string, ttsRaw: string) => {
      ummAvatarActivatedRef.current = false
      setDigitalHumanMode('idle')
      if (!requirePluginFn) {
        questionTtsPlayingRef.current = false
        resetAnswerPhaseAvatar()
        setCallStatusLine('请口述您的回答')
        if (!transcribingRef.current) openRecognition(sidInner)
        else resumeAnswerAfterQuestionTts(sidInner)
        return
      }
      const activeMgr = recordManagerRef.current
      if (activeMgr) {
        try {
          activeMgr.stop?.()
        } catch {
          /* ignore */
        }
      }
      recordManagerRef.current = null
      setTranscribing(false)
      questionTtsPlayingRef.current = true
      setCallStatusLine('AI 正在读题...')
      closeAnswerTranscriptDisplay()
      transcriptFinalizedRef.current = []
      setTranscriptFinalized([])
      setTranscriptStreaming('')
      latestLiveTranscriptSyncRef.current = ''
      const ttsText = String(ttsRaw || '').trim()
      const ttsStartAt = Date.now()
      // 兜底屏蔽时长只防异常早结束；主要防护靠读题前硬停识别和开头回声相似度过滤。
      const minTtsCoverMs = Math.max(1800, Math.min(8000, ttsText.length * 70 + 1000))
      ignoreRecognizeBeforeTsRef.current = ttsStartAt + minTtsCoverMs
      let prebuilt: string | undefined
      if (pendingUsePrefetchedFirstTtsRef.current && questionIndexRef.current === 0) {
        pendingUsePrefetchedFirstTtsRef.current = false
        const f = firstQuestionPrefetchedFileRef.current
        if (f) prebuilt = f
      }
      playInterviewQuestionTts(
        ttsText,
        {
          requirePlugin: (name) => requirePluginFn(name),
          audioRef: questionInnerAudioRef,
          onStatus: setCallStatusLine,
          onPlayStart: () => {
            firstQuestionNeedsTapRetryRef.current = false
            setDigitalHumanMode('speaking')
          },
          prebuiltFilename: prebuilt
        },
        () => {
          if (questionIndexRef.current === 0 && questionTtsPlayingRef.current) {
            firstQuestionNeedsTapRetryRef.current = true
            setCallStatusLine('自动读题失败，请点击页面任意位置后重试')
          }
          // 播报一结束立刻停开场 MP4，回到 PNG（不等 holdMs）
          resetAnswerPhaseAvatar()
          const elapsed = Date.now() - ttsStartAt
          const holdMs = Math.max(0, minTtsCoverMs - elapsed)
          const releaseTtsAndResume = () => {
            questionTtsPlayingRef.current = false
            // 短冷却避免读题尾音进框，同时尽量不吞候选人开头作答。
            ignoreRecognizeBeforeTsRef.current = Date.now() + 360
            setTranscriptStreaming('')
            setTimeout(() => resumeAnswerAfterQuestionTts(sidInner), 60)
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
        resetAnswerPhaseAvatar()
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
  }, [
    cancelTranscriptRemoteDebounce,
    scheduleTranscriptRemote,
    pushTranscriptRemoteNow,
    setDigitalHumanMode,
    resetAnswerPhaseAvatar,
    activateUmmAvatarOnUserSpeech,
    closeAnswerTranscriptDisplay
  ])

  const handleAnyTapRetryFirstQuestion = useCallback(() => {
    if (!firstQuestionNeedsTapRetryRef.current) return
    if (questionIndexRef.current !== 0) {
      firstQuestionNeedsTapRetryRef.current = false
      return
    }
    const { sid, text } = firstListenGateRef.current
    if (!sid || !String(text).trim()) return
    firstQuestionNeedsTapRetryRef.current = false
    pendingTtsAfterStopRef.current = text
    pendingUsePrefetchedFirstTtsRef.current = Boolean(firstQuestionPrefetchedFileRef.current)
    setCallStatusLine('已检测到点击，准备重试语音读题…')
    void startWechatSiTranscribe(sid, false)
  }, [startWechatSiTranscribe])

  useDidShow(() => {
    visibleRef.current = true
    // 回到面试页时小程序可能已暂停原生视频，按当前状态重新驱动一次。
    setTimeout(() => {
      if (visibleRef.current) applyDigitalHumanPlayback(dhModeRef.current)
    }, 200)
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
        ummAvatarActivatedRef.current = false
        setDigitalHumanMode('idle')
        closeAnswerTranscriptDisplay()
        try {
          setCallStatusLine('正在准备题目…')
          followUpConfigRef.current = DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG
          const resumeScreeningId =
            typeof p.resumeScreeningId === 'number' ? p.resumeScreeningId : undefined
          const questionFetchOpts = {
            inviteCode: p.inviteCode,
            sessionId: sid
          }
          const questionsCacheKey = buildInterviewQuestionsCacheKey(
            j.id,
            p.name,
            resumeScreeningId,
            p.inviteCode
          )

          const [list] = await Promise.all([
            fetchInterviewQuestionsOrPrefetched(j.id, p.name, resumeScreeningId, questionFetchOpts),
            fetchInterviewFollowUpConfig(j.id, sid)
              .then((cfg) => {
                followUpConfigRef.current = { ...DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG, ...cfg }
                flowLogInfo(
                  '追问配置',
                  `enabled=${cfg.enabled ? '1' : '0'} max=${cfg.maxPerInterview} waitMs=${cfg.modelWaitMs}`
                )
                return cfg
              })
              .catch(() => {
                followUpConfigRef.current = DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG
                return null
              })
          ])

          const cleaned = list.filter((q) => q && String(q.text || '').trim())
          if (!cleaned.length) throw new Error('empty questions')
          flowLog('AI 题目生成', true, `${cleaned.length} 题`)
          flowLogInfo('AI 首题', cleaned[0]?.text?.slice(0, 40) || '')
          setQuestions(cleaned)
          if (cleaned.length < 6 && cleaned[0]?.text) {
            ensureInterviewQuestionsRest(
              j.id,
              p.name,
              cleaned[0].text,
              resumeScreeningId,
              questionFetchOpts,
              (merged) => {
                if (!visibleRef.current) return
                const next = merged.filter((q) => q && String(q.text || '').trim())
                if (next.length > questionCountRef.current) {
                  setQuestions(next)
                  flowLogInfo('面试页', `后续题目已就绪，共 ${next.length} 题`)
                }
              }
            )
          }
          followUpCountRef.current = 0
          followUpParentIdsRef.current = new Set()
          transcriptFinalizedRef.current = []
          setTranscriptFinalized([])
          setTranscriptStreaming('')
          setSessionId(sid)

          await Promise.all([
            startLiveSession({
              sessionId: sid,
              jobId: j.id,
              candidateName: p.name,
              candidateOpenId: p.openid,
              questions: cleaned
            }),
            p.openid
              ? bindSessionMember({ sessionId: sid, role: 'candidate', openid: p.openid })
              : Promise.resolve()
          ])

          flowLog('面试页 拉题+startLiveSession', true, `${cleaned.length} 题`)
          if (!transcribingRef.current) {
            flowLogInfo('面试页', '首题：需在本页点击后播放读题（微信音频策略）')
            const q0 = cleaned[0]?.text ?? ''
            pendingTtsAfterStopRef.current = q0
            firstListenGateRef.current = { sid, text: q0 }
            firstQuestionNeedsTapRetryRef.current = false
            setCallStatusLine('题目已就绪，准备自动语音读题…')
            const warmedTts = consumePrefetchedFirstQuestionTts(questionsCacheKey)
            firstQuestionPrefetchedFileRef.current = warmedTts
            pendingUsePrefetchedFirstTtsRef.current = Boolean(warmedTts)
            if (requirePluginFn && String(q0).trim() && !warmedTts) {
              if (firstQuestionPrefetchUiTimerRef.current) {
                clearTimeout(firstQuestionPrefetchUiTimerRef.current)
                firstQuestionPrefetchUiTimerRef.current = null
              }
              firstQuestionTtsPrefetchingRef.current = true
              firstQuestionPrefetchUiTimerRef.current = setTimeout(() => {
                firstQuestionPrefetchUiTimerRef.current = null
                firstQuestionTtsPrefetchingRef.current = false
              }, 15000)
              prefetchInterviewQuestionTtsPath(q0, (name) => requirePluginFn(name), (path) => {
                if (firstQuestionPrefetchUiTimerRef.current) {
                  clearTimeout(firstQuestionPrefetchUiTimerRef.current)
                  firstQuestionPrefetchUiTimerRef.current = null
                }
                firstQuestionTtsPrefetchingRef.current = false
                if (!visibleRef.current) return
                if (path) {
                  firstQuestionPrefetchedFileRef.current = path
                  pendingUsePrefetchedFirstTtsRef.current = true
                  flowLogInfo('面试页', '首题读题音频已预拉取')
                }
              })
            } else if (warmedTts) {
              flowLogInfo('面试页', '使用候场预拉的首题读题音频')
            }
            void startWechatSiTranscribe(sid, false)
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
        // 用 ref 取当前题目，闭包里的 questions 在 useDidShow 回调中可能是初始空数组。
        const currentText = String(
          (questionListRef.current[questionIndexRef.current]?.text ?? '') || ''
        ).trim()
        flowLogInfo('面试页', '回到面试页：先停转写再读题')
        pendingTtsAfterStopRef.current = currentText
        setCallStatusLine(currentText ? '准备语音读题…' : '请口述您的回答')
        // 强制重启：返回/切后台再回前台后，录音识别需要重新 start，否则会出现“有声无字”。
        void startWechatSiTranscribe(sid, true)
      }
    })()
  })

  const current = questions[index]
  const isFollowUp = current?.type === 'follow_up'
  const mainQuestionCount = useMemo(
    () => questions.filter((q) => q.type !== 'follow_up').length,
    [questions]
  )
  const currentMainOrdinal = useMemo(
    () => questions.slice(0, index + 1).filter((q) => q.type !== 'follow_up').length,
    [questions, index]
  )
  const parentQuestion = useMemo(() => {
    if (!current?.parentQuestionId) return null
    return questions.find((q) => q.id === current.parentQuestionId) ?? null
  }, [current, questions])
  const isLast = questions.length > 0 && index === questions.length - 1
  const composedAnswer = useMemo(
    () => (transcriptFinalized.join('') + transcriptStreaming).trim(),
    [transcriptFinalized, transcriptStreaming]
  )
  const canNext = useMemo(() => composedAnswer.length >= 2, [composedAnswer])
  const speakingHighlight = transcribing && transcriptStreaming.length > 0

  const buildShortAnswerFollowUp = useCallback((parent: InterviewQuestion, answer: string): InterviewQuestion | null => {
    const cfg = followUpConfigRef.current
    if (!cfg.enabled || !cfg.fallbackEnabled || cfg.demoMode) return null
    const compact = String(answer || '').replace(/\s+/g, '')
    if (compact.length >= cfg.shortAnswerThreshold) return null
    return {
      id: `FU-${parent.id}-short`,
      text: '可以结合一个具体项目或经历，再展开说明一下吗？',
      type: 'follow_up',
      parentQuestionId: parent.id
    }
  }, [])

  const fetchFollowUpWithoutWaiting = useCallback(
    async (parent: InterviewQuestion, answer: string): Promise<InterviewQuestion | null> => {
      const cfg = followUpConfigRef.current
      if (!cfg.enabled) return null
      if (!sessionId) return null
      if (parent.type === 'follow_up') return null
      if (cfg.maxPerInterview <= 0 || cfg.maxPerQuestion <= 0) return null
      if (!cfg.demoMode && followUpCountRef.current >= cfg.maxPerInterview) return null
      if (followUpParentIdsRef.current.has(parent.id)) return null

      const mainOrdinal =
        questionListRef.current
          .slice(0, questionIndexRef.current + 1)
          .filter((q) => q.type !== 'follow_up').length || 0
      flowLogInfo(
        '追问检查',
        `mainOrdinal=${mainOrdinal} index=${questionIndexRef.current} qid=${parent.id} answerLen=${answer.length}`
      )

      const got = await fetchPreparedFollowUp({
        sessionId,
        questionId: parent.id,
        waitMs: cfg.demoMode ? Math.max(cfg.modelWaitMs, 3500) : cfg.modelWaitMs
      }).catch(() => null)
      flowLogInfo('追问检查', `追问状态=${got?.status || 'request_failed'}`)
      if (got?.status === 'ready' && got.question?.text) {
        return {
          ...got.question,
          type: 'follow_up',
          parentQuestionId: got.question.parentQuestionId || parent.id
        }
      }
      return buildShortAnswerFollowUp(parent, answer)
    },
    [buildShortAnswerFollowUp, sessionId]
  )

  const handleNext = async () => {
    if (!current || !canNext || !profile || !job) return

    cancelTranscriptRemoteDebounce()
    pushTranscriptRemoteNow(sessionId, composedAnswer)

    const currentQa = { questionId: current.id, question: current.text, answer: composedAnswer }
    const nextAnswers = [...answers, currentQa]
    setAnswers(nextAnswers)
    await syncLiveQa({ sessionId, ...currentQa })
    transcriptFinalizedRef.current = []
    setTranscriptFinalized([])
    setTranscriptStreaming('')

    const followUp = await fetchFollowUpWithoutWaiting(current, composedAnswer)
    if (followUp?.text) {
      followUpCountRef.current += 1
      followUpParentIdsRef.current.add(current.id)
      const nextIdx = index + 1
      const nextQuestions = [...questions]
      nextQuestions.splice(nextIdx, 0, followUp)
      setQuestions(nextQuestions)
      closeAnswerTranscriptDisplay()
      ummAvatarActivatedRef.current = false
      setDigitalHumanMode('idle')
      pendingTtsAfterStopRef.current = followUp.text
      setCallStatusLine('面试官有一则追问，请听题后补充作答')
      setIndex(nextIdx)
      void startWechatSiTranscribe(sessionId, true)
      return
    }

    if (!isLast) {
      const nextIdx = index + 1
      closeAnswerTranscriptDisplay()
      ummAvatarActivatedRef.current = false
      setDigitalHumanMode('idle')
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
  /** 当前应播放的数字人视频尚未就绪或正在缓冲时，显示 loading 遮罩 */
  const showVideoLoading =
    (dhMode === 'speaking' && (!openingVideoReady || openingVideoBuffering)) ||
    (dhMode === 'listening' && (!ummVideoReady || ummVideoBuffering))

  return (
    <View className='safe-container interview-page' onClick={handleAnyTapRetryFirstQuestion}>
      <View className='interview-hero'>
        <View className='interviewer-stage'>
          <View className='interviewer-bg' />
          <View className='interviewer-figure-layer'>
            <View className='interviewer-avatar-stack'>
              <View className='interviewer-circle-cluster'>
                <View className='interviewer-circle-frame'>
                  <View
                    className={`interviewer-circle-fill${dhMode === 'idle' ? ' interviewer-circle-fill--active' : ''}`}
                    style={
                      AI_INTERVIEWER_IMG_URL
                        ? { backgroundImage: `url(${JSON.stringify(AI_INTERVIEWER_IMG_URL)})` }
                        : undefined
                    }
                  />
                  <View
                    className={`interviewer-circle-video-layer${dhMode !== 'idle' ? ' interviewer-circle-video-layer--active' : ''}`}
                  >
                    <Video
                      id={OPENING_VIDEO_ID}
                      className={`interviewer-circle-video${dhMode === 'speaking' ? ' interviewer-circle-video--active' : ''}`}
                      src={openingVideoSrc}
                      poster={AI_INTERVIEWER_IMG_URL || ''}
                      loop
                      muted
                      autoplay={false}
                      controls={false}
                      showCenterPlayBtn={false}
                      showPlayBtn={false}
                      showProgress={false}
                      showFullscreenBtn={false}
                      enableProgressGesture={false}
                      objectFit='cover'
                      onLoadedMetaData={() => {
                        setOpeningVideoReady(true)
                        if (dhModeRef.current === 'speaking' && visibleRef.current) {
                          try {
                            Taro.createVideoContext(OPENING_VIDEO_ID)?.play?.()
                          } catch {
                            /* ignore */
                          }
                        }
                      }}
                      onPlay={() => setOpeningVideoBuffering(false)}
                      onTimeUpdate={() => setOpeningVideoBuffering(false)}
                      onWaiting={() => setOpeningVideoBuffering(true)}
                      onError={handleOpeningVideoError}
                    />
                    <Video
                      id={UMM_VIDEO_ID}
                      className={`interviewer-circle-video${dhMode === 'listening' ? ' interviewer-circle-video--active' : ''}`}
                      src={ummVideoSrc}
                      poster={AI_INTERVIEWER_IMG_URL || ''}
                      loop={false}
                      muted
                      autoplay={false}
                      controls={false}
                      showCenterPlayBtn={false}
                      showPlayBtn={false}
                      showProgress={false}
                      showFullscreenBtn={false}
                      enableProgressGesture={false}
                      objectFit='cover'
                      onEnded={handleUmmVideoEnded}
                      onLoadedMetaData={() => {
                        setUmmVideoReady(true)
                        if (dhModeRef.current === 'listening' && visibleRef.current) {
                          try {
                            Taro.createVideoContext(UMM_VIDEO_ID)?.play?.()
                          } catch {
                            /* ignore */
                          }
                        }
                      }}
                      onPlay={() => setUmmVideoBuffering(false)}
                      onTimeUpdate={() => setUmmVideoBuffering(false)}
                      onWaiting={() => setUmmVideoBuffering(true)}
                      onError={handleUmmVideoError}
                    />
                    {showVideoLoading ? (
                      <View className='interviewer-circle-loading'>
                        <View className='interviewer-circle-spinner' />
                      </View>
                    ) : null}
                  </View>
                  <View className='interviewer-circle-badge'>
                    <Text className='interviewer-circle-badge-text'>AI 面试官</Text>
                  </View>
                </View>
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
          {isFollowUp ? (
            <Text className='progress progress--follow-up'>
              追问 · 第 {currentMainOrdinal || 1} 题的补充说明
            </Text>
          ) : (
            <Text className='progress'>
              第 {currentMainOrdinal || 0} 题 / 共 {mainQuestionCount || '--'} 题
            </Text>
          )}
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
          {isFollowUp ? (
            <View className='follow-up-notice'>
              <View className='follow-up-notice-head'>
                <Text className='follow-up-badge'>追问</Text>
                <Text className='follow-up-hint'>面试官希望进一步了解您刚才的回答</Text>
              </View>
              {parentQuestion?.text ? (
                <View className='follow-up-parent'>
                  <Text className='follow-up-parent-label'>刚才的问题</Text>
                  <Text className='follow-up-parent-text'>{parentQuestion.text}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Text className={`question-text${isFollowUp ? ' question-text--follow-up' : ''}`}>
            {current?.text || (questions.length ? '题目索引异常' : '正在加载题目…')}
          </Text>
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
          {isLast ? '提交面试' : isFollowUp ? '完成追问，继续' : '下一题'}
        </Button>
        <Text className='transcript-tip'>本服务为AI生成内容，结果仅供参考</Text>
      </View>
    </View>
  )
}
