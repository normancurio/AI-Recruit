import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'
import { loginWithInviteCode } from '../../services/interviewApi'
import { loginAndGetOpenId } from '../../services/authApi'
import type { CandidateProfile } from '../../types/interview'
import { flowLog, flowLogInfo } from '../../utils/flowLog'

import './index.scss'

export default function LoginPage() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)

  useDidShow(async () => {
    try {
      let oid = (Taro.getStorageSync('wx_openid') as string) || ''
      if (!oid) {
        flowLogInfo('登录页', '补拉 wx_openid')
        oid = await loginAndGetOpenId('candidate')
        Taro.setStorageSync('wx_openid', oid)
      }
      flowLog('登录页 预热 openid', true, oid ? 'ok' : '')
    } catch {
      flowLog('登录页 预热 openid', false, '见 authApi 报错')
    }
  })

  const canSubmit = useMemo(() => {
    return Boolean(name.trim() && phone.trim() && inviteCode.trim())
  }, [inviteCode, name, phone])

  const handleNext = async () => {
    const code = inviteCode.trim().toUpperCase()
    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      Taro.showToast({ title: '请输入真实姓名（至少2个字）', icon: 'none' })
      return
    }
    // 后台结构化邀请码为「岗位码-发起人账号-筛查记录 id」（见 server buildStructuredInviteCode），
    // 另支持仅岗位码、历史 INV 前缀等；具体有效性由 /api/candidate/login-invite 校验。
    if (code.length < 4 || code.length > 128) {
      Taro.showToast({ title: '邀请码须 4～128 位', icon: 'none' })
      return
    }
    if (!/^[A-Z0-9_.@-]+$/.test(code)) {
      Taro.showToast({ title: '邀请码仅字母数字及 -_.@', icon: 'none' })
      return
    }
    const phoneTrimmed = phone.replace(/\D/g, '').trim()
    if (!/^1[3-9]\d{9}$/.test(phoneTrimmed)) {
      Taro.showToast({ title: '请输入本人11位手机号（用于匹配面试报告）', icon: 'none' })
      return
    }
    try {
      setLoading(true)
      const loginRes = await Taro.login()
      if (!loginRes.code) {
        Taro.showToast({ title: '微信登录失败', icon: 'none' })
        return
      }
      const data = await loginWithInviteCode({
        code: loginRes.code,
        inviteCode: code,
        name: trimmedName,
        phone: phoneTrimmed
      })
      Taro.setStorageSync('wx_openid', data.openid)
      Taro.setStorageSync('session_id', data.sessionId)
      if (data.trtc) {
        Taro.setStorageSync('trtc_credential', data.trtc)
      } else {
        try {
          Taro.removeStorageSync('trtc_credential')
        } catch {
          /* ignore */
        }
      }
      const profile: CandidateProfile = {
        name: data.name,
        phone: phoneTrimmed,
        inviteCode: code,
        openid: data.openid
      }
      if (typeof data.resumeScreeningId === 'number' && data.resumeScreeningId > 0) {
        profile.resumeScreeningId = data.resumeScreeningId
      }
      Taro.setStorageSync('candidate_profile', profile)
      Taro.setStorageSync('candidate_job', data.job)
      flowLog('登录 login-invite', true, `session=${data.sessionId} trtc=${data.trtc ? 'yes' : 'no'}`)
      Taro.navigateTo({ url: '/pages/lobby/index' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '登录或邀请码校验失败'
      flowLog('登录 login-invite', false, msg)
      Taro.showToast({ title: msg.slice(0, 24), icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='safe-container login-page'>
      <View className='header'>
        <Text className='title'>欢迎参加面试</Text>
        <Text className='subtitle'>请填写与投递简历一致的姓名和手机号</Text>
      </View>

      <View className='card form-card'>
        <View className='field'>
          <Text className='label'>
            姓名<Text className='required-star'>*</Text>
          </Text>
          <Input
            className='input'
            value={name}
            placeholder='请输入真实姓名'
            onInput={(e) => setName(e.detail.value)}
          />
          <Text className='field-tip'>姓名错误会影响后台定位，请务必与简历保持一致</Text>
        </View>

        <View className='field'>
          <Text className='label'>
            手机号<Text className='required-star'>*</Text>
          </Text>
          <Input
            className='input'
            value={phone}
            type='number'
            maxlength={11}
            placeholder='请输入手机号'
            onInput={(e) => setPhone(String(e.detail.value || '').replace(/\D/g, '').slice(0, 11))}
          />
          <Text className='field-tip'>用于唯一匹配面试报告，建议与简历手机号一致</Text>
        </View>

        <View className='field'>
          <Text className='label'>
            邀请码<Text className='required-star'>*</Text>
          </Text>
          <Input
            className='input'
            value={inviteCode}
            placeholder='HR 提供的岗位码或完整码'
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
