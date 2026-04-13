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
    return Boolean(name.trim() && inviteCode.trim())
  }, [inviteCode, name])

  const handleNext = async () => {
    const code = inviteCode.trim().toUpperCase()
    // 后台结构化邀请码为「岗位码-发起人账号-筛查记录 id」（见 server buildStructuredInviteCode），
    // 另支持仅岗位码、历史 INV 前缀等；具体有效性由 /api/candidate/login-invite 校验。
    if (code.length < 4 || code.length > 128) {
      Taro.showToast({ title: '邀请码长度应在 4～128 个字符', icon: 'none' })
      return
    }
    if (!/^[A-Z0-9_.@-]+$/.test(code)) {
      Taro.showToast({ title: '邀请码仅支持字母、数字与 - _ . @', icon: 'none' })
      return
    }
    try {
      setLoading(true)
      const loginRes = await Taro.login()
      if (!loginRes.code) {
        Taro.showToast({ title: '微信登录失败，请重试', icon: 'none' })
        return
      }
      const data = await loginWithInviteCode({
        code: loginRes.code,
        inviteCode: code,
        name: name.trim(),
        phone: phone.trim() || undefined
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
        phone: phone.trim(),
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
          <Text className='label'>手机号（选填）</Text>
          <Input
            className='input'
            value={phone}
            type='number'
            maxlength={11}
            placeholder='选填，便于企业联系'
            onInput={(e) => setPhone(e.detail.value)}
          />
        </View>

        <View className='field'>
          <Text className='label'>面试邀请码</Text>
          <Input
            className='input'
            value={inviteCode}
            placeholder='例如 J001 或 J001-账号-编号'
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
