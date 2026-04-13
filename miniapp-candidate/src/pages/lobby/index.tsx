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
  })

  /** 答题页会拉题、建会话；纯 AI 面无需人工接听视频 */
  const handleEnterInterview = () => {
    if (!profile || !job) return
    const cachedSid = (Taro.getStorageSync('session_id') as string) || ''
    const sid = cachedSid || `${job.id}-${profile.openid || profile.phone || 'unknown'}`
    Taro.setStorageSync('session_id', sid)
    Taro.navigateTo({ url: '/pages/interview/index' })
  }

  return (
    <View className='safe-container lobby-page'>
      <View className='card'>
        <Text className='welcome'>你好，{profile?.name || '候选人'}！</Text>
        <Text className='desc'>欢迎参加「{job?.title || '待定'}」的 AI 面试，请确认环境就绪后进入答题。</Text>

        <View className='tips'>
          <Text>1. 邀请由企业方发出，请勿向他人泄露邀请码</Text>
          <Text>2. 请在安静环境、网络稳定下进行，并允许相机与麦克风权限</Text>
          <Text>3. 面试为 AI 对话：需开启摄像头（本机预览），语音将转写为文字用于作答与评估</Text>
          <Text>
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
