import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { CandidateProfile, JobInfo } from '../../types/interview'

import './index.scss'

export default function LobbyPage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [job, setJob] = useState<JobInfo | null>(null)

  useDidShow(() => {
    const p = Taro.getStorageSync('candidate_profile') as CandidateProfile | undefined
    const j = Taro.getStorageSync('candidate_job') as JobInfo | undefined
    if (!p?.name || !p?.inviteCode || !j?.id) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }
    setProfile(p)
    setJob(j)
  })

  return (
    <View className='safe-container lobby-page'>
      <View className='card'>
        <Text className='welcome'>你好，{profile?.name || '候选人'}！</Text>
        <Text className='desc'>欢迎参加「{job?.title || '待定'}」的初试，请确认环境就绪后接听面试邀请。</Text>

        <View className='tips'>
          <Text>1. 邀请由面试官/HR 发出，请勿向他人泄露邀请码</Text>
          <Text>2. 请在安静环境、网络稳定下进行</Text>
          <Text>3. 可开启同声转写；如需视频，由面试官发起 VoIP</Text>
        </View>

        <Button className='primary-btn' onClick={() => Taro.navigateTo({ url: '/pages/interview/index' })}>
          接听面试邀请
        </Button>
      </View>
    </View>
  )
}
