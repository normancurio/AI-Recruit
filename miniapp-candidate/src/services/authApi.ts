import Taro from '@tarojs/taro'

import { assertApiBase, httpErrorMessage } from '../config/apiBase'

export async function loginAndGetOpenId(role: 'candidate' | 'interviewer'): Promise<string> {
  const base = assertApiBase()
  const loginRes = await Taro.login()
  const code = loginRes.code || ''
  if (!code) throw new Error('获取微信登录 code 失败，请重开小程序再试')

  const res = await Taro.request<{ data: { openid: string } }>({
    url: `${base}/api/wechat/login`,
    method: 'POST',
    data: { code, role }
  })
  if (res.statusCode >= 400 || !res.data?.data?.openid) {
    throw new Error(httpErrorMessage(res, '换取 openid 失败'))
  }
  return res.data.data.openid
}
