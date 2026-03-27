import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, ScrollView, Text, View } from '@tarojs/components'

import { API_BASE } from '../../config/apiBase'
import {
  bindSessionMember,
  fetchInterviewerInvitations,
  getLiveSessionState,
  type InterviewerInvitation,
  type LiveSessionState
} from '../../services/interviewApi'
import { loginAndGetOpenId } from '../../services/authApi'

import './index.scss'

const wxApi = (globalThis as any).wx

function mergeQuestionsForBoard(state: LiveSessionState) {
  const qaById = new Map(state.qa.map((x) => [x.questionId, x]))
  if (state.questions?.length) {
    return state.questions.map((q) => ({
      id: q.id,
      question: q.text,
      answer: qaById.get(q.id)?.answer || ''
    }))
  }
  return state.qa.map((x) => ({
    id: x.questionId,
    question: x.question,
    answer: x.answer
  }))
}

export default function InterviewerPage() {
  const [selfOpenId, setSelfOpenId] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [sessions, setSessions] = useState<InterviewerInvitation[]>([])
  const [listError, setListError] = useState('')

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [liveState, setLiveState] = useState<LiveSessionState | null>(null)
  const [roomError, setRoomError] = useState('')
  const [startingVoip, setStartingVoip] = useState(false)

  const ensureOpenId = useCallback(async () => {
    let oid = (Taro.getStorageSync('wx_openid') as string) || ''
    if (!oid) {
      oid = await loginAndGetOpenId('interviewer')
      Taro.setStorageSync('wx_openid', oid)
    }
    setSelfOpenId(oid)
    Taro.setStorageSync('interviewer_openid', oid)
    return oid
  }, [])

  const loadSessions = useCallback(async () => {
    if (!API_BASE) return
    setListLoading(true)
    setListError('')
    try {
      const oid = await ensureOpenId()
      const rows = await fetchInterviewerInvitations(oid)
      setSessions(rows)
    } catch {
      setListError('加载面试列表失败，请检查网络与后端')
      setSessions([])
    } finally {
      setListLoading(false)
    }
  }, [ensureOpenId])

  useDidShow(() => {
    if (wxApi?.setEnable1v1Chat) {
      wxApi.setEnable1v1Chat({ enable: true })
    }
    if (!activeSessionId) {
      loadSessions()
    }
  })

  useEffect(() => {
    ensureOpenId().catch(() => {
      Taro.showToast({ title: '面试官登录失败', icon: 'none' })
    })
  }, [ensureOpenId])

  useEffect(() => {
    if (!activeSessionId || !selfOpenId) return
    bindSessionMember({
      sessionId: activeSessionId,
      role: 'interviewer',
      openid: selfOpenId
    }).catch(() => {})
  }, [activeSessionId, selfOpenId])

  useEffect(() => {
    if (!activeSessionId) return
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = async () => {
      try {
        const data = await getLiveSessionState(activeSessionId)
        setLiveState(data)
        setRoomError('')
      } catch {
        setRoomError('会话不存在或未开始，请返回列表')
      }
    }
    tick()
    timer = setInterval(tick, 1500)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [activeSessionId])

  const mergedBoard = useMemo(() => (liveState ? mergeQuestionsForBoard(liveState) : []), [liveState])

  const candidateOpenId = String(liveState?.candidateOpenId || '').trim()
  const interviewerOpenId = String(liveState?.interviewerOpenId || selfOpenId || '').trim()
  const canStartVoip = Boolean(activeSessionId && candidateOpenId && interviewerOpenId && wxApi?.join1v1Chat)

  const startVideoCall = async () => {
    if (!activeSessionId || !canStartVoip) {
      Taro.showToast({ title: '双方未就绪或不支持视频', icon: 'none' })
      return
    }
    try {
      setStartingVoip(true)
      await bindSessionMember({
        sessionId: activeSessionId,
        role: 'interviewer',
        openid: selfOpenId
      })
      const latest = await getLiveSessionState(activeSessionId)
      const c = String(latest.candidateOpenId || '').trim()
      const iv = String(latest.interviewerOpenId || selfOpenId).trim()
      if (!c || !iv) {
        Taro.showToast({ title: '请确认候选人已进入面试页', icon: 'none' })
        return
      }
      wxApi.join1v1Chat({
        caller: { openId: iv },
        listener: { openId: c },
        success: () => Taro.showToast({ title: '视频通话已启动', icon: 'none' }),
        fail: () => Taro.showToast({ title: '启动失败，请检查权限与插件', icon: 'none' })
      })
    } catch {
      Taro.showToast({ title: '发起失败', icon: 'none' })
    } finally {
      setStartingVoip(false)
    }
  }

  const openSession = (row: InterviewerInvitation) => {
    if (!row.sessionId) {
      Taro.showToast({ title: '候选人尚未接受邀请', icon: 'none' })
      return
    }
    setActiveSessionId(row.sessionId)
    setLiveState(null)
    setRoomError('')
    Taro.setNavigationBarTitle({ title: '面试进行中' })
  }

  const backToList = () => {
    setActiveSessionId(null)
    setLiveState(null)
    setRoomError('')
    Taro.setNavigationBarTitle({ title: '面试官看板' })
    loadSessions()
  }

  if (activeSessionId) {
    return (
      <View className='safe-container interviewer-page'>
        <View className='card block'>
          <Button className='ghost-btn' onClick={backToList}>
            返回面试列表
          </Button>
          <Text className='title'>{liveState?.jobTitle || '面试进行中'}</Text>
          {liveState?.department ? <Text className='meta'>{liveState.department}</Text> : null}
          <Text className='meta dim'>会话：{activeSessionId}</Text>

          <Button
            className='primary-btn'
            loading={startingVoip}
            disabled={!canStartVoip || startingVoip}
            onClick={startVideoCall}
          >
            发起视频面试（VoIP）
          </Button>
          <Text className={`status ${canStartVoip ? 'status-ok' : 'status-wait'}`}>
            {!wxApi?.join1v1Chat
              ? '当前基础库不支持 VoIP 或未配置插件'
              : !candidateOpenId
                ? '等待候选人打开「答题」页面…'
                : !interviewerOpenId
                  ? '正在绑定面试官身份…'
                  : '可发起视频，画面为微信 VoIP 通话界面'}
          </Text>
          {roomError ? <Text className='error'>{roomError}</Text> : null}
        </View>

        <View className='card block'>
          <Text className='sub-title'>AI 题目与候选人回答</Text>
          <ScrollView scrollY className='panel panel-tall'>
            {mergedBoard.length ? (
              mergedBoard.map((row) => (
                <View key={row.id} className='qa-item'>
                  <Text className='q-label'>题目</Text>
                  <Text className='q'>{row.question || '（无题干）'}</Text>
                  <Text className='a-label'>候选人回答</Text>
                  <Text className='a'>{row.answer?.trim() ? row.answer : '尚未提交或未同步…'}</Text>
                </View>
              ))
            ) : (
              <Text className='empty'>等待候选人加载题目并作答，内容将自动刷新</Text>
            )}
          </ScrollView>
        </View>

        <View className='card block'>
          <Text className='sub-title'>候选人实时转写 / 输入</Text>
          <ScrollView scrollY className='panel'>
            {liveState?.transcript?.length ? (
              liveState.transcript
                .slice()
                .reverse()
                .map((item, idx) => (
                  <View key={`${item.ts}-${idx}`} className='line'>
                    {item.text}
                  </View>
                ))
            ) : (
              <Text className='empty'>暂无转写（候选人在答题框输入会同步到这里）</Text>
            )}
          </ScrollView>
        </View>
      </View>
    )
  }

  return (
    <View className='safe-container interviewer-page'>
      <View className='card block'>
        <Text className='title'>我的邀请列表</Text>
        <Text className='hint'>可查看你创建的邀请。候选人接受后，点击该条即可进入看板并发起视频。</Text>
        <Button className='secondary-btn' loading={listLoading} onClick={loadSessions}>
          刷新列表
        </Button>
        {listError ? <Text className='error'>{listError}</Text> : null}
      </View>

      <ScrollView scrollY className='invite-scroll'>
        {sessions.length === 0 && !listLoading ? (
          <Text className='empty pad'>暂无邀请记录。</Text>
        ) : (
          sessions.map((s) => (
            <View key={s.inviteCode} className='invite-card' onClick={() => openSession(s)}>
              <Text className='invite-title'>{s.jobTitle || s.jobId}</Text>
              <Text className='invite-sub'>{s.department}</Text>
              <Text className='invite-meta'>岗位代码 {s.jobId}</Text>
              <Text className='invite-meta'>候选人 {s.candidateName || s.candidatePhone || '未登记'}</Text>
              <Text className='invite-meta'>状态 {s.inviteStatus}</Text>
              <Text className='invite-meta dim'>邀请码 {s.inviteCode}</Text>
              <Text className='invite-meta dim'>会话 {s.sessionId || '待候选人接受后生成'}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
