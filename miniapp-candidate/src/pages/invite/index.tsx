import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'

import { acceptInvitation, getMyInvitations, getMyProfile } from '../../services/userApi'

import './index.scss'

type Invitation = {
  inviteId: string
  jobId: string
  title: string
  department: string
}

export default function InvitePage() {
  const [loading, setLoading] = useState(false)
  const [invites, setInvites] = useState<Invitation[]>([])
  const [error, setError] = useState('')

  useDidShow(async () => {
    const openid = (Taro.getStorageSync('wx_openid') as string) || ''
    if (!openid) {
      Taro.reLaunch({ url: '/pages/entry/index' })
      return
    }
    try {
      const me = await getMyProfile(openid)
      if (me.role === 'interviewer') {
        Taro.reLaunch({ url: '/pages/interviewer/index' })
        return
      }
      // 业务守卫：候选人未绑定手机号时，不允许直接停留在邀请页，回登录页重新完成登录/授权。
      if (!me.phone) {
        Taro.removeStorageSync('candidate_profile')
        Taro.removeStorageSync('candidate_job')
        Taro.showToast({ title: '请先完成登录并绑定手机号', icon: 'none' })
        Taro.reLaunch({ url: '/pages/login/index' })
        return
      }
      const list = await getMyInvitations(openid)
      setInvites(list)
      setError('')
    } catch (e) {
      setError('加载邀请失败')
    }
  })

  const handleAccept = async (invite: Invitation) => {
    const openid = (Taro.getStorageSync('wx_openid') as string) || ''
    if (!openid) return
    try {
      setLoading(true)
      const data = await acceptInvitation({ openid, inviteId: invite.inviteId })
      Taro.setStorageSync('candidate_profile', { name: '候选人', phone: '', inviteCode: invite.jobId, openid })
      Taro.setStorageSync('candidate_job', {
        id: data.job.id,
        title: data.job.title,
        department: data.job.department
      })
      Taro.setStorageSync('session_id', data.sessionId)
      Taro.reLaunch({ url: '/pages/interview/index' })
    } catch (e) {
      Taro.showToast({ title: '同意失败，请重试', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const invite = invites[0] || null

  return (
    <View className='safe-container invite-page'>
      <View className='card'>
        <Text className='title'>我收到一个面试邀请</Text>
        {error ? <Text className='error'>{error}</Text> : null}

        {invite ? (
          <View className='info'>
            <Text className='row'>岗位：{invite.title}</Text>
            <Text className='row'>部门：{invite.department}</Text>
            <Text className='row dim'>邀请码：{invite.inviteId}</Text>
          </View>
        ) : (
          <Text className='empty'>暂无新的面试邀请</Text>
        )}

        {invite ? (
          <Button className='primary-btn' loading={loading} onClick={() => handleAccept(invite)}>
            同意并开始面试
          </Button>
        ) : null}
      </View>
    </View>
  )
}

