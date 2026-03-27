import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'

import { acceptInvitation, bindMyPhoneByWechat, getMyInvitations, getMyProfile } from '../../services/userApi'

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
  const [phoneBound, setPhoneBound] = useState(false)
  const [bindingPhone, setBindingPhone] = useState(false)

  useDidShow(async () => {
    const openid = (Taro.getStorageSync('wx_openid') as string) || ''
    if (!openid) {
      Taro.reLaunch({ url: '/pages/entry/index' })
      return
    }
    try {
      const me = await getMyProfile(openid)
      setPhoneBound(Boolean(me.phone))
      const list = await getMyInvitations(openid)
      setInvites(list)
      setError('')
    } catch (e) {
      setError('加载邀请失败')
    }
  })

  const onGetPhoneNumber = async (e: any) => {
    const openid = (Taro.getStorageSync('wx_openid') as string) || ''
    if (!openid) return
    const detail = e?.detail || {}
    if (detail.errMsg && String(detail.errMsg).includes('deny')) {
      Taro.showToast({ title: '你拒绝了手机号授权', icon: 'none' })
      return
    }
    const encryptedData = String(detail.encryptedData || '')
    const iv = String(detail.iv || '')
    if (!encryptedData || !iv) {
      Taro.showToast({ title: '未获取到手机号信息', icon: 'none' })
      return
    }
    try {
      setBindingPhone(true)
      const r = await bindMyPhoneByWechat({ openid, encryptedData, iv })
      setPhoneBound(true)
      if (r.role === 'interviewer') {
        Taro.showToast({ title: '识别为面试官，已跳转', icon: 'none' })
        Taro.reLaunch({ url: '/pages/interviewer/index' })
      }
    } catch (err) {
      Taro.showToast({ title: '手机号绑定失败，请重试', icon: 'none' })
    } finally {
      setBindingPhone(false)
    }
  }

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

        {!phoneBound && (
          <View className='phone-block'>
            <Text className='hint'>为便于识别面试官/候选人身份，请先授权绑定手机号。</Text>
            <Button
              className='secondary-btn'
              openType='getPhoneNumber'
              onGetPhoneNumber={onGetPhoneNumber}
              loading={bindingPhone}
              disabled={bindingPhone}
            >
              授权手机号
            </Button>
          </View>
        )}

        {invite ? (
          <>
            <View className='info'>
              <Text className='row'>岗位：{invite.title}</Text>
              <Text className='row'>部门：{invite.department}</Text>
            </View>

            <Button className='primary-btn' disabled={!phoneBound} loading={loading} onClick={() => handleAccept(invite)}>
              同意并开始面试
            </Button>
          </>
        ) : (
          <Text className='empty'>暂无新的面试邀请</Text>
        )}
      </View>
    </View>
  )
}

