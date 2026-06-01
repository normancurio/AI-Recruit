import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import InterviewCamera from '../components/InterviewCamera'
import { AI_INTERVIEWER_IMG_URL } from '../config/api'
import { useAnswerTranscript } from '../hooks/useAnswerTranscript'
import type { TrtcPublisher } from '../adapters/trtcWeb'
import {
  DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG,
  bindSessionMember,
  fetchInterviewFollowUpConfig,
  fetchInterviewQuestionsOrPrefetched,
  fetchPreparedFollowUp,
  startLiveSession,
  submitInterview,
  syncLiveQa,
  type InterviewFollowUpConfig
} from '../services/interviewApi'
import type { InterviewAnswer, InterviewQuestion } from '../types/interview'
import { getJob, getOpenId, getProfile, getSessionId, setSessionId } from '../utils/storage'
import { primeSpeechSynthesis } from '../utils/speech'

const ASR_MODE_LABEL: Record<string, string> = {
  xfyun: '讯飞实时转写',
  web: '浏览器实时转写',
  server: '服务端语音转写',
  manual: '手动输入'
}

export default function InterviewPage() {
  const navigate = useNavigate()
  const profile = getProfile()
  const job = getJob()
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [manualText, setManualText] = useState('')
  const [answers, setAnswers] = useState<InterviewAnswer[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionIdState] = useState(getSessionId())
  const [statusLine, setStatusLine] = useState('正在连接…')
  const [initError, setInitError] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [videoMode, setVideoMode] = useState<'trtc' | 'fallback' | 'loading'>('loading')
  const trtcPublisherRef = useRef<TrtcPublisher | null>(null)

  const userId = profile?.openid || profile?.phone || ''

  const followUpConfigRef = useRef<InterviewFollowUpConfig>(DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG)
  const followUpCountRef = useRef(0)
  const followUpParentIdsRef = useRef<Set<string>>(new Set())
  const initMarkerRef = useRef('')
  const questionIndexRef = useRef(0)
  const questionsRef = useRef<InterviewQuestion[]>([])
  questionsRef.current = questions
  questionIndexRef.current = index

  const getCurrentQuestion = useCallback(
    () => questionsRef.current[questionIndexRef.current],
    []
  )

  const {
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
  } = useAnswerTranscript({
    sessionId,
    getCurrentQuestion,
    onStatus: setStatusLine,
    onTrtcSubtitle: (text) => {
      trtcPublisherRef.current?.sendSubtitle(text)
    }
  })

  const beginQuestionRef = useRef(beginQuestion)
  beginQuestionRef.current = beginQuestion
  const stopAllRef = useRef(stopAll)
  stopAllRef.current = stopAll

  const handlePublisherReady = useCallback((pub: TrtcPublisher | null) => {
    trtcPublisherRef.current = pub
    setVideoMode(pub ? 'trtc' : 'fallback')
  }, [])

  const handleTapToSpeak = useCallback(() => {
    primeSpeechSynthesis()
    if (needsTapToSpeak) retrySpeakAfterTap()
  }, [needsTapToSpeak, retrySpeakAfterTap])

  const current = questions[index]
  const isLast = questions.length > 0 && index === questions.length - 1
  const composedAnswer = useMemo(() => {
    const manual = manualText.trim()
    return manual || spokenText
  }, [manualText, spokenText])
  const canNext = composedAnswer.length >= 2

  const fetchFollowUp = useCallback(
    async (parent: InterviewQuestion, answer: string) => {
      const cfg = followUpConfigRef.current
      if (!cfg.enabled || !sessionId || parent.type === 'follow_up') return null
      if (followUpCountRef.current >= cfg.maxPerInterview) return null
      if (followUpParentIdsRef.current.has(parent.id)) return null
      const got = await fetchPreparedFollowUp({
        sessionId,
        questionId: parent.id,
        waitMs: cfg.modelWaitMs
      })
      if (got?.status === 'ready' && got.question?.text) {
        return {
          ...got.question,
          type: 'follow_up' as const,
          parentQuestionId: got.question.parentQuestionId || parent.id
        }
      }
      const compact = answer.replace(/\s+/g, '')
      if (cfg.fallbackEnabled && compact.length < cfg.shortAnswerThreshold) {
        return {
          id: `FU-${parent.id}-short`,
          text: '可以结合一个具体项目或经历，再展开说明一下吗？',
          type: 'follow_up' as const,
          parentQuestionId: parent.id
        }
      }
      return null
    },
    [sessionId]
  )

  useEffect(() => {
    if (!profile?.name || !job?.id) {
      navigate('/', { replace: true })
      return
    }
    const sid = getSessionId() || `${job.id}-${profile.openid || profile.phone || 'unknown'}`
    setSessionId(sid)
    setSessionIdState(sid)
    const marker = `${job.id}\t${sid}\t${profile.openid || ''}`
    if (initMarkerRef.current === marker) return
    initMarkerRef.current = marker

    void (async () => {
      setInitError('')
      try {
        setStatusLine('正在准备题目…')
        void fetchInterviewFollowUpConfig(job.id, sid).then((cfg) => {
          followUpConfigRef.current = { ...DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG, ...cfg }
        })
        const list = await fetchInterviewQuestionsOrPrefetched(
          job.id,
          profile.name,
          profile.resumeScreeningId
        )
        const cleaned = list.filter((q) => q && String(q.text || '').trim())
        if (!cleaned.length) throw new Error('无题目')
        setQuestions(cleaned)
        followUpCountRef.current = 0
        followUpParentIdsRef.current = new Set()
        try {
          await startLiveSession({
            sessionId: sid,
            jobId: job.id,
            candidateName: profile.name,
            candidateOpenId: profile.openid,
            questions: cleaned
          })
          const oid = getOpenId() || profile.openid
          if (oid) {
            await bindSessionMember({ sessionId: sid, role: 'candidate', openid: oid })
          }
        } catch (e) {
          const warn = e instanceof Error ? e.message : '会话同步失败'
          setStatusLine(`${warn}，面试可继续作答`)
        }
        beginQuestionRef.current(cleaned[0]?.text || '')
      } catch (e) {
        initMarkerRef.current = ''
        setInitError(e instanceof Error ? e.message : '初始化失败')
      }
    })()
  }, [job?.id, navigate, profile?.name, profile?.openid, profile?.phone, profile?.resumeScreeningId])

  useEffect(() => {
    return () => {
      void stopAllRef.current()
    }
  }, [])

  const advanceQuestion = useCallback(
    (nextIdx: number, nextQuestions: InterviewQuestion[], questionText: string) => {
      questionsRef.current = nextQuestions
      questionIndexRef.current = nextIdx
      setQuestions(nextQuestions)
      setIndex(nextIdx)
      resetForNextQuestion()
      setManualText('')
      beginQuestion(questionText)
    },
    [beginQuestion, resetForNextQuestion]
  )

  const handleNext = async () => {
    if (!current || !canNext || !profile || !job || !sessionId || loading) return
    setLoading(true)
    setStatusLine('正在保存本题回答…')
    flushBeforeSubmit()
    await stopAll()
    const qa = { questionId: current.id, question: current.text, answer: composedAnswer }
    const nextAnswers = [...answers, qa]
    setAnswers(nextAnswers)
    try {
      await syncLiveQa({ sessionId, ...qa })
    } catch {
      setStatusLine('答题同步失败，继续下一题…')
    }

    let followUp: InterviewQuestion | null = null
    try {
      setStatusLine('正在准备下一题…')
      followUp = await fetchFollowUp(current, composedAnswer)
    } catch {
      followUp = null
    }

    if (followUp?.text) {
      followUpCountRef.current += 1
      followUpParentIdsRef.current.add(current.id)
      const nextIdx = index + 1
      const nextQuestions = [...questions]
      nextQuestions.splice(nextIdx, 0, followUp)
      setLoading(false)
      advanceQuestion(nextIdx, nextQuestions, followUp.text)
      return
    }

    if (!isLast) {
      const nextIdx = index + 1
      const nextText = questionsRef.current[nextIdx]?.text || questions[nextIdx]?.text || ''
      setLoading(false)
      advanceQuestion(nextIdx, questions, nextText)
      return
    }

    try {
      setStatusLine('正在提交面试…')
      await submitInterview(profile, job.id, nextAnswers, sessionId)
      await stopAll()
      navigate('/result', { replace: true })
    } catch {
      setStatusLine('提交失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" onClick={handleTapToSpeak}>
      <div className="interview-grid">
        <div className="ai-panel">
          <div
            className="ai-avatar"
            style={{ backgroundImage: `url(${JSON.stringify(AI_INTERVIEWER_IMG_URL)})` }}
          />
          <span className="ai-badge">AI 面试官</span>
          <p className="status-line">{statusLine}</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#1e40af' }}>
            转写模式：{ASR_MODE_LABEL[asrMode] || asrMode}
            {videoMode === 'trtc' ? ' · TRTC 推流' : videoMode === 'fallback' ? ' · 本地预览' : ''}
          </p>
          <h2 style={{ margin: '10px 0 4px', fontSize: 22 }}>{job?.title || '岗位面试'}</h2>
          <p style={{ margin: 0, color: '#475569' }}>
            第 {questions.length ? Math.min(index + 1, questions.length) : 0} 题 / 共{' '}
            {questions.length || '--'} 题
          </p>
        </div>
        <div style={{ minHeight: 280 }}>
          {sessionId && userId ? (
            <InterviewCamera
              sessionId={sessionId}
              userId={userId}
              onError={setCameraError}
              onPublisherReady={handlePublisherReady}
            />
          ) : null}
          {cameraError ? <p style={{ color: '#b91c1c', fontSize: 13 }}>{cameraError}</p> : null}
        </div>
      </div>

      <div className="card">
        {initError ? (
          <div style={{ background: '#fef2f2', padding: 16, borderRadius: 12, marginBottom: 16 }}>
            <p style={{ color: '#b91c1c', margin: '0 0 8px' }}>{initError}</p>
            <button className="btn-secondary" type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        ) : null}

        {needsTapToSpeak ? (
          <div
            style={{
              background: '#fff7ed',
              border: '1px solid #fdba74',
              padding: '12px 16px',
              borderRadius: 12,
              marginBottom: 16
            }}
          >
            <p style={{ margin: 0, color: '#c2410c', fontSize: 14 }}>
              浏览器拦截了自动读题，请点击页面任意位置开始语音读题
            </p>
          </div>
        ) : null}

        <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b', margin: '0 0 8px' }}>当前题目</p>
        <p style={{ fontSize: 18, lineHeight: 1.7, margin: '0 0 20px' }}>
          {current?.text || (questions.length ? '题目索引异常' : '正在加载题目…')}
        </p>

        <p style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>
          实时转写回答
          {transcribing ? '（识别中）' : ''}
        </p>
        <div className="transcript-box">
          {!showAnswerTranscript ? (
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 14 }}>读题中，转写内容暂不显示</p>
          ) : null}
          {showAnswerTranscript && spokenText ? (
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {spokenText}
            </p>
          ) : null}
          {showAnswerTranscript &&
          !spokenText &&
          !transcribing &&
          asrMode !== 'manual' ? (
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 14 }}>请直接口述作答，转写文本将显示在这里</p>
          ) : null}
          {asrMode === 'manual' || !transcribing ? (
            <textarea
              className="field"
              style={{ width: '100%', minHeight: 88, marginTop: 10, border: 'none', background: 'transparent' }}
              value={manualText}
              placeholder={asrMode === 'manual' ? '请在此输入您的回答' : '也可在此补充或手动输入'}
              onChange={(e) => setManualText(e.target.value)}
            />
          ) : null}
        </div>

        <button
          className="btn-primary"
          type="button"
          disabled={!canNext || loading || !current}
          onClick={() => void handleNext()}
        >
          {loading ? '提交中…' : isLast ? '提交面试' : '下一题'}
        </button>
      </div>
    </div>
  )
}
