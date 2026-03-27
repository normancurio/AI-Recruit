import Taro, { useDidShow } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import { Button, Text, Textarea, View } from '@tarojs/components'

import {
  bindSessionMember,
  fetchInterviewQuestions,
  getLiveSessionState,
  startLiveSession,
  submitInterview,
  syncLiveQa,
  syncLiveTranscript
} from '../../services/interviewApi'
import { CandidateProfile, InterviewAnswer, InterviewQuestion, JobInfo } from '../../types/interview'

import './index.scss'

const requirePluginFn = (globalThis as any).requirePlugin as ((name: string) => any) | undefined
const wxApi = (globalThis as any).wx
// 临时联调：面试官 openid（17317476943）
const FIXED_INTERVIEWER_OPENID = 'oWLZU11sFJgmZ8fZR2q_iJfqFD0A'

export default function InterviewPage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [job, setJob] = useState<JobInfo | null>(null)
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [answers, setAnswers] = useState<InterviewAnswer[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [transcriptTip, setTranscriptTip] = useState('未开启同声转写')
  const [startingVoip, setStartingVoip] = useState(false)
  const [voipTip, setVoipTip] = useState('由微信 VoIP 承载视频画面（非页面内 video）')
  const [voipStatus, setVoipStatus] = useState<'idle' | 'starting' | 'waiting_accept' | 'connected' | 'failed'>('idle')
  const [voipDebug, setVoipDebug] = useState('')

  useDidShow(async () => {
    const p = Taro.getStorageSync('candidate_profile') as CandidateProfile | undefined
    const j = Taro.getStorageSync('candidate_job') as JobInfo | undefined
    if (!p?.name || !j?.id) {
      Taro.redirectTo({ url: '/pages/entry/index' })
      return
    }
    setProfile(p)
    setJob(j)
    if (questions.length === 0) {
      try {
        const list = await fetchInterviewQuestions(j.id)
        setQuestions(list)
        const cachedSid = (Taro.getStorageSync('session_id') as string) || ''
        const sid = cachedSid || `${j.id}-${p.openid || p.phone || 'unknown'}`
        setSessionId(sid)
        await startLiveSession({
          sessionId: sid,
          jobId: j.id,
          candidateName: p.name,
          candidateOpenId: p.openid,
          questions: list
        })
        if (p.openid) {
          await bindSessionMember({ sessionId: sid, role: 'candidate', openid: p.openid })
        }
      } catch (e) {
        Taro.showToast({ title: '题目加载失败', icon: 'none' })
      }
    }
  })

  const current = questions[index]
  const isLast = index === questions.length - 1
  const canNext = useMemo(() => answer.trim().length >= 5, [answer])

  const startRealtimeTranscribe = async () => {
    if (transcribing || !sessionId) return
    // 微信同声传译依赖 WechatSI 插件。若未配置插件，自动降级为手动输入。
    try {
      if (!requirePluginFn) throw new Error('plugin api unavailable')
      const plugin = requirePluginFn('WechatSI')
      const manager = plugin.getRecordRecognitionManager()
      manager.onRecognize = (res: { result?: string }) => {
        const text = res?.result || ''
        if (!text) return
        setAnswer(text)
        syncLiveTranscript(sessionId, text)
      }
      manager.onStop = (res: { result?: string }) => {
        const text = res?.result || ''
        if (text) {
          setAnswer(text)
          syncLiveTranscript(sessionId, text)
        }
        setTranscribing(false)
        setTranscriptTip('转写已停止')
      }
      manager.onError = () => {
        setTranscribing(false)
        setTranscriptTip('转写失败，请改为手动输入')
      }
      manager.start({ lang: 'zh_CN', duration: 60000 })
      setTranscribing(true)
      setTranscriptTip('同声转写进行中...')
    } catch (e) {
      setTranscriptTip('未配置 WechatSI 插件，当前使用手动输入')
    }
  }

  const stopRealtimeTranscribe = () => {
    try {
      if (!requirePluginFn) throw new Error('plugin api unavailable')
      const plugin = requirePluginFn('WechatSI')
      const manager = plugin.getRecordRecognitionManager()
      manager.stop()
    } catch (e) {
      setTranscribing(false)
    }
  }

  const startWechatVoip = async () => {
    if (!sessionId || !profile?.openid) {
      Taro.showToast({ title: '会话未就绪', icon: 'none' })
      return
    }
    if (!wxApi?.setEnable1v1Chat || !wxApi?.join1v1Chat) {
      setVoipStatus('failed')
      setVoipDebug('wx.setEnable1v1Chat / wx.join1v1Chat 不存在（开发者工具可能不支持）')
      Taro.showToast({ title: '当前环境不支持 1v1 VoIP', icon: 'none' })
      return
    }
    try {
      setStartingVoip(true)
      setVoipStatus('starting')
      await new Promise<void>((resolve, reject) => {
        wxApi.setEnable1v1Chat({
          enable: true,
          success: () => resolve(),
          fail: (err: unknown) => reject(err)
        })
      })
      await bindSessionMember({ sessionId, role: 'candidate', openid: profile.openid })
      const state = await getLiveSessionState(sessionId)
      const interviewerOpenId = String(state?.interviewerOpenId || FIXED_INTERVIEWER_OPENID).trim()
      const candidateOpenId = String(profile.openid || '').trim()
      setVoipDebug(
        [
          `sessionId=${sessionId}`,
          `candidateOpenId=${candidateOpenId || '(empty)'}`,
          `interviewerOpenId=${interviewerOpenId || '(empty)'}`,
          `fixedInterviewerOpenId=${FIXED_INTERVIEWER_OPENID}`,
          'mode=join1v1Chat(caller/listener)'
        ].join('\n')
      )
      if (!interviewerOpenId || !candidateOpenId) {
        setVoipTip('面试官 openid 未就绪，请稍后重试')
        setVoipStatus('failed')
        Taro.showToast({ title: '面试官未就绪', icon: 'none' })
        return
      }
      setVoipTip('已发起视频邀请，等待对方接听...')
      setVoipStatus('waiting_accept')
      wxApi.join1v1Chat({
        caller: { openId: candidateOpenId },
        listener: { openId: interviewerOpenId },
        success: (ok: unknown) => {
          setVoipStatus('connected')
          setVoipDebug((prev) => `${prev}\njoin1v1Chat success=${JSON.stringify(ok || {})}`)
          setVoipTip(`1v1 邀请已发起：候选人 ${candidateOpenId} / 面试官 ${interviewerOpenId}`)
          Taro.showToast({ title: '视频邀请已发起', icon: 'none' })
        },
        fail: (err: unknown) => {
          setVoipStatus('failed')
          setVoipDebug((prev) => `${prev}\njoin1v1Chat fail=${JSON.stringify(err || {})}`)
          setVoipTip('1v1 发起失败，请检查接口开通、类目和权限')
          Taro.showToast({ title: '视频邀请失败', icon: 'none' })
        }
      })
    } catch (e: unknown) {
      setVoipStatus('failed')
      setVoipDebug((prev) => `${prev}\nexception=${JSON.stringify(e || {})}`)
      setVoipTip('获取会话状态失败，请稍后重试')
      Taro.showToast({ title: '发起失败', icon: 'none' })
    } finally {
      setStartingVoip(false)
    }
  }

  useDidShow(() => {
    if (!wxApi?.setEnable1v1Chat) return
    wxApi.setEnable1v1Chat({
      enable: true,
      fail: (err: unknown) => {
        setVoipStatus('failed')
        setVoipDebug((prev) => `${prev}\nsetEnable1v1Chat fail=${JSON.stringify(err || {})}`)
      }
    })
    if (wxApi?.onVoIPChatInterrupted) {
      wxApi.onVoIPChatInterrupted((evt: unknown) => {
        setVoipStatus('failed')
        setVoipTip('通话中断，请重试')
        setVoipDebug((prev) => `${prev}\nonVoIPChatInterrupted=${JSON.stringify(evt || {})}`)
      })
    }
  })

  const handleNext = async () => {
    if (!current || !canNext || !profile || !job) return

    const currentQa = { questionId: current.id, question: current.text, answer: answer.trim() }
    const nextAnswers = [...answers, currentQa]
    setAnswers(nextAnswers)
    await syncLiveQa({ sessionId, ...currentQa })
    setAnswer('')

    if (!isLast) {
      setIndex((v) => v + 1)
      return
    }

    try {
      setLoading(true)
      const result = await submitInterview(profile, job.id, nextAnswers)
      Taro.setStorageSync('interview_result', result)
      Taro.redirectTo({ url: '/pages/result/index' })
    } catch (e) {
      Taro.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='safe-container interview-page'>
      <View className='card'>
        <Text className='job-title'>{job?.title || '岗位面试'}</Text>
        <Text className='progress'>
          第 {Math.min(index + 1, questions.length || 1)} 题 / 共 {questions.length || '--'} 题
        </Text>

        <View className='question-box'>
          <Text className='question-text'>{current?.text || '正在加载题目...'}</Text>
        </View>

        <Textarea
          className='answer-input'
          value={answer}
          maxlength={300}
          placeholder='请输入你的回答（至少5个字）'
          onInput={(e) => {
            const val = e.detail.value
            setAnswer(val)
            syncLiveTranscript(sessionId, val)
          }}
        />

        <Button className='voip-btn' loading={startingVoip} disabled={startingVoip || !profile?.openid} onClick={startWechatVoip}>
          进入视频面试（微信 VoIP）
        </Button>
        <Text className='voip-tip'>{voipTip}</Text>
        <Text className={`voip-state voip-${voipStatus}`}>
          {voipStatus === 'idle'
            ? '通话状态：未发起'
            : voipStatus === 'starting'
              ? '通话状态：发起中'
              : voipStatus === 'waiting_accept'
                ? '通话状态：等待对方接听'
                : voipStatus === 'connected'
                  ? '通话状态：已接通 / 已拉起微信通话界面'
                  : '通话状态：失败'}
        </Text>
        {voipDebug ? <Text className='voip-debug'>{voipDebug}</Text> : null}

        <Text className='transcript-tip'>{transcriptTip}</Text>
        <View className='transcript-actions'>
          <Button className='secondary-btn' onClick={startRealtimeTranscribe} disabled={transcribing}>
            开启同声转写
          </Button>
          <Button className='secondary-btn stop-btn' onClick={stopRealtimeTranscribe} disabled={!transcribing}>
            停止转写
          </Button>
        </View>

        <Button className='primary-btn' loading={loading} disabled={!canNext || loading || !current} onClick={handleNext}>
          {isLast ? '提交面试' : '下一题'}
        </Button>
      </View>
    </View>
  )
}
