import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, ScrollView, Text, View } from '@tarojs/components'

import { getApiBase } from '../../config/apiBase'
import {
  acceptVideoInterview,
  bindSessionMember,
  fetchInterviewerInvitations,
  fetchInterviewerLiveSessions,
  getLiveSessionState,
  type InterviewerInvitation,
  type LiveSessionState,
  type LiveSessionSummary
} from '../../services/interviewApi'
import { loginAndGetOpenId } from '../../services/authApi'
import { join1v1VideoChat, setEnable1v1Chat } from '../../utils/voip1v1'

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
  /** 手填邀请码等未出现在「我的邀请」里、但候选人已进入的会话 */
  const [liveExtras, setLiveExtras] = useState<LiveSessionSummary[]>([])
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
    if (!getApiBase()) return
    setListLoading(true)
    setListError('')
    try {
      const oid = await ensureOpenId()
      const [invR, liveR] = await Promise.allSettled([
        fetchInterviewerInvitations(oid),
        fetchInterviewerLiveSessions()
      ])
      const invRows = invR.status === 'fulfilled' ? invR.value : []
      const liveRows = liveR.status === 'fulfilled' ? liveR.value : []
      const failed: string[] = []
      if (invR.status === 'rejected') failed.push('邀请列表')
      if (liveR.status === 'rejected') failed.push('进行中会话')
      setListError(failed.length ? `${failed.join('、')}加载失败` : '')
      const sidFromInv = new Set(
        invRows.map((r) => String(r.sessionId || '').trim()).filter(Boolean)
      )
      const extras = liveRows.filter((r) => {
        const sid = String(r.sessionId || '').trim()
        if (!sid || sidFromInv.has(sid)) return false
        const iv = String(r.interviewerOpenId || '').trim()
        return !iv || iv === oid
      })
      setSessions(invRows)
      setLiveExtras(extras)
    } catch {
      setListError('加载失败，请检查网络与后端')
      setSessions([])
      setLiveExtras([])
    } finally {
      setListLoading(false)
    }
  }, [ensureOpenId])

  useDidShow(() => {
    if (wxApi?.setEnable1v1Chat) {
      wxApi.setEnable1v1Chat({ enable: true })
    }
    if (!activeSessionId) {
      void loadSessions()
    }
  })

  useEffect(() => {
    void ensureOpenId().catch(() => {
      Taro.showToast({ title: '面试官登录失败', icon: 'none' })
    })
  }, [ensureOpenId])

  /** 进入会话后持续把当前面试官 openid 写入会话，供候选人 VoIP 使用 */
  useEffect(() => {
    if (!activeSessionId || !selfOpenId) return
    void bindSessionMember({
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
    void tick()
    timer = setInterval(tick, 1500)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [activeSessionId])

  const mergedBoard = useMemo(() => (liveState ? mergeQuestionsForBoard(liveState) : []), [liveState])

  const candidateOpenId = String(liveState?.candidateOpenId || '').trim()
  const selfOid = String(selfOpenId || '').trim()
  const waitingAccept = String(liveState?.voipStatus || '') === 'waiting_interviewer_accept'
  /** 会话与双方 openid 就绪 */
  const canVideoSession = Boolean(activeSessionId && candidateOpenId && selfOid && liveState)
  /** 候选人已发起：只需系统接听能力，不应再 join1v1Chat（否则会再拨一通反向电话） */
  const canAnswerIncoming = Boolean(canVideoSession && wxApi?.setEnable1v1Chat)
  /** 面试官主动呼叫候选人 */
  const canDialCandidate = Boolean(canVideoSession && wxApi?.setEnable1v1Chat && wxApi?.join1v1Chat)
  const canPrimaryVoip = waitingAccept ? canAnswerIncoming : canDialCandidate

  const enterSessionAndBind = async (sessionId: string) => {
    const oid = await ensureOpenId()
    setActiveSessionId(sessionId)
    setLiveState(null)
    setRoomError('')
    Taro.setNavigationBarTitle({ title: '面试进行中' })
    try {
      await bindSessionMember({ sessionId, role: 'interviewer', openid: oid })
    } catch {
      Taro.showToast({ title: '绑定面试官身份失败，可稍后重试', icon: 'none' })
    }
  }

  const openInvitationSession = async (row: InterviewerInvitation) => {
    if (!row.sessionId) {
      Taro.showToast({ title: '候选人尚未接受邀请', icon: 'none' })
      return
    }
    await enterSessionAndBind(row.sessionId)
  }

  const openLiveOnlySession = async (row: LiveSessionSummary) => {
    const sid = String(row.sessionId || '').trim()
    if (!sid) return
    await enterSessionAndBind(sid)
  }

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
        openid: selfOid
      })
      const latest = await getLiveSessionState(activeSessionId)
      const c = String(latest.candidateOpenId || '').trim()
      if (!c) {
        Taro.showToast({ title: '请确认候选人已进入面试页', icon: 'none' })
        return
      }
      await acceptVideoInterview(activeSessionId)
      wxApi.join1v1Chat({
        caller: { openId: selfOid },
        listener: { openId: c },
        mode: 'video',
        style: 'float_small',
        success: () => Taro.showToast({ title: '已接听视频面试', icon: 'none' }),
        fail: () => Taro.showToast({ title: '启动失败，请检查权限与插件', icon: 'none' })
      })
    } catch {
      Taro.showToast({ title: '发起失败', icon: 'none' })
    } finally {
      setStartingVoip(false)
    }
  }

  const backToList = () => {
    setActiveSessionId(null)
    setLiveState(null)
    setRoomError('')
    Taro.setNavigationBarTitle({ title: '面试官看板' })
    void loadSessions()
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
            disabled={!canPrimaryVoip || startingVoip}
            onClick={() => void startVideoCall()}
          >
            {waitingAccept ? '已发起？去微信系统界面接听' : '主动联系候选人视频'}
          </Button>
          <Text className={`status ${canPrimaryVoip ? 'status-ok' : 'status-wait'}`}>
            {!wxApi?.setEnable1v1Chat
              ? '当前基础库不支持双人通话或未开通接口'
              : !liveState
                ? '正在同步会话…'
                : !candidateOpenId
                  ? '等待候选人打开「答题」页面并登录…'
                  : waitingAccept
                    ? '候选人已发起：您应在微信系统界面接听，不要把它当成「再点一次发起通话」。上方按钮仅同步状态并弹出说明。'
                    : !wxApi?.join1v1Chat
                      ? '无法主动拨出：请升级基础库或开通 join1v1Chat'
                      : '候选人未点发起时，您可用上方按钮主动呼叫对方视频。'}
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
        <Text className='title'>面试官看板</Text>
        <Text className='hint'>
          「我的邀请」为绑定给您的邀约；「进行中的面试」包含手填邀请码已进入的候选人。进入会话后会自动绑定您的 openid，便于对方发起视频。
        </Text>
        <Button className='secondary-btn' loading={listLoading} onClick={() => void loadSessions()}>
          刷新列表
        </Button>
        {listError ? <Text className='error'>{listError}</Text> : null}
      </View>

      <ScrollView scrollY className='invite-scroll'>
        {sessions.length === 0 && liveExtras.length === 0 && !listLoading ? (
          <Text className='empty pad'>暂无数据。请确认后台邀请已关联您的账号（interviewer_openid / interviewer_user_id）。</Text>
        ) : null}

        {sessions.length > 0 ? (
          <>
            <Text className='section-label'>我的邀请</Text>
            {sessions.map((s) => (
              <View
                key={`${s.inviteCode}-${s.sessionId || 'pending'}`}
                className='invite-card'
                onClick={() => void openInvitationSession(s)}
              >
                <Text className='invite-title'>{s.jobTitle || s.jobId}</Text>
                <Text className='invite-sub'>{s.department}</Text>
                <Text className='invite-meta'>岗位代码 {s.jobId}</Text>
                <Text className='invite-meta'>候选人 {s.candidateName || s.candidatePhone || '未登记'}</Text>
                <Text className='invite-meta'>状态 {s.inviteStatus}</Text>
                <Text className='invite-meta dim'>邀请码 {s.inviteCode}</Text>
                <Text className='invite-meta dim'>会话 {s.sessionId || '待候选人接受后生成'}</Text>
              </View>
            ))}
          </>
        ) : null}

        {liveExtras.length > 0 ? (
          <>
            <Text className='section-label'>进行中的面试</Text>
            {liveExtras.map((s) => (
              <View key={s.sessionId} className='invite-card invite-card-live' onClick={() => void openLiveOnlySession(s)}>
                <Text className='invite-title'>{s.jobTitle || s.jobId}</Text>
                <Text className='invite-sub'>{s.department}</Text>
                <Text className='invite-meta dim'>会话 {s.sessionId}</Text>
                <Text className='invite-meta'>
                  {String(s.voipStatus || '') === 'waiting_interviewer_accept' ? '视频：待您接听' : '视频：未请求或已连接'}
                </Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}
