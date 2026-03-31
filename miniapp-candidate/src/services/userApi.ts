import Taro from '@tarojs/taro'

import { assertApiBase, httpErrorMessage } from '../config/apiBase'

export async function getMyProfile(openid: string): Promise<{ openid: string; role: 'candidate' | 'interviewer'; phone?: string }> {
  const base = assertApiBase()
  const res = await Taro.request<{ data: { openid: string; role: 'candidate' | 'interviewer'; phone?: string } }>({
    url: `${base}/api/user/me`,
    method: 'GET',
    data: { openid }
  })
  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error(httpErrorMessage(res, '拉取用户信息失败'))
  }
  return res.data.data
}

export async function bindMyPhone(params: { openid: string; phone: string }) {
  const base = assertApiBase()
  const res = await Taro.request<{ data: { role: 'candidate' | 'interviewer' } }>({
    url: `${base}/api/user/bind-phone`,
    method: 'POST',
    data: params
  })
  if (res.statusCode >= 400 || !res.data?.data) throw new Error('bind phone failed')
  return res.data.data
}

export async function getMyInvitations(openid: string) {
  const base = assertApiBase()
  const res = await Taro.request<{ data: any[] }>({
    url: `${base}/api/candidate/invitations`,
    method: 'GET',
    data: { openid }
  })
  if (res.statusCode >= 400 || !Array.isArray(res.data?.data)) throw new Error('get invites failed')
  return res.data.data
}

export async function acceptInvitation(params: { openid: string; inviteId: string }) {
  const base = assertApiBase()
  const res = await Taro.request<{ data: { sessionId: string; job: { id: string; title: string; department: string } } }>({
    url: `${base}/api/candidate/invitations/accept`,
    method: 'POST',
    data: params
  })
  if (res.statusCode >= 400 || !res.data?.data) throw new Error('accept failed')
  return res.data.data
}

export async function bindMyPhoneByWechat(params: { openid: string; encryptedData: string; iv: string }) {
  const base = assertApiBase()
  const res = await Taro.request<{ data: { phone: string; role: 'candidate' | 'interviewer' } }>({
    url: `${base}/api/wechat/phone`,
    method: 'POST',
    data: params
  })
  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error(httpErrorMessage(res, '手机号授权失败'))
  }
  return res.data.data
}

