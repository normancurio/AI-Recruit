import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { CandidateProfile, JobInfo } from '../../types/interview'
import { prefetchInterviewQuestions } from '../../services/interviewApi'
import { flowLogInfo } from '../../utils/flowLog'

import './index.scss'

export default function LobbyPage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [job, setJob] = useState<JobInfo | null>(null)

  useDidShow(() => {
    const p = Taro.getStorageSync('candidate_profile') as CandidateProfile | undefined
    const j = Taro.getStorageSync('candidate_job') as JobInfo | undefined
    if (!p?.name || !p?.inviteCode || !j?.id) {
      flowLogInfo('等候区', '资料不全，回登录')
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }
    flowLogInfo('等候区', `岗位 ${j.title} session=${(Taro.getStorageSync('session_id') as string) || ''}`)
    setProfile(p)
    setJob(j)
    void prefetchInterviewQuestions(j.id, p.name, typeof p.resumeScreeningId === 'number' ? p.resumeScreeningId : undefined)
  })

  /** 答题页会拉题、建会话；纯 AI 面无需人工接听视频 */
  const handleEnterInterview = async () => {
    if (!profile || !job) return
    const cachedSid = (Taro.getStorageSync('session_id') as string) || ''
    const sid = cachedSid || `${job.id}-${profile.openid || profile.phone || 'unknown'}`
    Taro.setStorageSync('session_id', sid)
    /* 在用户点击链路内预申请录音，避免进面试页后首题读题与系统弹麦克风抢音频会话导致无声 */
    try {
      const st = await Taro.getSetting()
      if (!st.authSetting?.['scope.record']) {
        await Taro.authorize({ scope: 'scope.record' })
      }
    } catch {
      /* 用户拒绝或未配置仍允许进入，面试页内会再提示 */
    }
    Taro.navigateTo({ url: '/pages/interview/index' })
  }

  return (
    <View className='safe-container lobby-page'>
      <View className='lobby-header'>
        <Text className='lobby-kicker'>面试准备</Text>
        <Text className='welcome'>{profile?.name || '候选人'}，你好</Text>
        <Text className='job-line'>「{job?.title || '待定'}」</Text>
      </View>

      <View className='card lobby-card'>
        <Text className='desc'>
          欢迎参加「{job?.title || '待定'}」的 AI 面试，请确认环境就绪后进入答题。
        </Text>

        <View className='tips'>
          <Text className='tip-line'>1. 邀请由企业方发出，请勿向他人泄露邀请码</Text>
          <Text className='tip-line'>2. 请在安静环境、网络稳定下进行，并允许相机与麦克风权限</Text>
          <Text className='tip-line'>
            3. 面试为 AI 对话：需开启摄像头（本机预览），语音将转写为文字用于作答与评估
          </Text>
          <Text className='tip-line'>
            4. 题目由服务端大模型根据 JD 与简历生成；在本页停留时已后台准备，进入答题页后通常更快出现
          </Text>
        </View>

        <Button className='primary-btn' onClick={handleEnterInterview}>
          进入 AI 面试
        </Button>
      </View>
    </View>
  )
}
