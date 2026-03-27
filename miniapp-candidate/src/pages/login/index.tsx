import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'
import { validateInviteCode } from '../../services/interviewApi'
import { loginAndGetOpenId } from '../../services/authApi'
import { getMyProfile } from '../../services/userApi'

import './index.scss'

export default function LoginPage() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [openid, setOpenid] = useState('')

  useDidShow(async () => {
    try {
      let oid = (Taro.getStorageSync('wx_openid') as string) || ''
      if (!oid) {
        oid = await loginAndGetOpenId('candidate')
        Taro.setStorageSync('wx_openid', oid)
      }
      setOpenid(oid)
      const me = await getMyProfile(oid)
      if (me.role === 'interviewer') {
        Taro.reLaunch({ url: '/pages/interviewer/index' })
        return
      }
      if (me.phone && !phone) {
        setPhone(me.phone)
      }
    } catch {
      // entry 页已有失败提示，这里不额外弹窗
    }
  })

  const canSubmit = useMemo(() => {
    return Boolean(name.trim() && phone.trim() && inviteCode.trim())
  }, [inviteCode, name, phone])

  const handleNext = async () => {
    const code = inviteCode.trim().toUpperCase()
    if (!/^J\d{3,}$/.test(code)) {
      Taro.showToast({ title: '邀请码格式不正确', icon: 'none' })
      return
    }
    try {
      setLoading(true)
      const oid = openid || (await loginAndGetOpenId('candidate'))
      Taro.setStorageSync('wx_openid', oid)
      const job = await validateInviteCode(code)
      Taro.setStorageSync('candidate_profile', {
        name: name.trim(),
        phone: phone.trim(),
        inviteCode: code,
        openid: oid
      })
      Taro.setStorageSync('candidate_job', job)
      Taro.navigateTo({ url: '/pages/lobby/index' })
    } catch (e) {
      Taro.showToast({ title: '登录或邀请码校验失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='safe-container login-page'>
      <View className='header'>
        <Text className='title'>欢迎参加面试</Text>
        <Text className='subtitle'>请输入您的真实姓名和手机号，并填写面试邀请码进行登记</Text>
      </View>

      <View className='card form-card'>
        <View className='field'>
          <Text className='label'>姓名</Text>
          <Input
            className='input'
            value={name}
            placeholder='请输入真实姓名'
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <View className='field'>
          <Text className='label'>手机号</Text>
          <Input
            className='input'
            value={phone}
            type='number'
            maxlength={11}
            placeholder='请输入11位手机号'
            onInput={(e) => setPhone(e.detail.value)}
          />
        </View>

        <View className='field'>
          <Text className='label'>面试邀请码</Text>
          <Input
            className='input'
            value={inviteCode}
            placeholder='例如 J001'
            onInput={(e) => setInviteCode(e.detail.value)}
          />
        </View>

        <Button className='primary-btn' loading={loading} disabled={!canSubmit || loading} onClick={handleNext}>
          下一步
        </Button>
      </View>
    </View>
  )
}
