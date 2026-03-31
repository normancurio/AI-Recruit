import Taro from '@tarojs/taro'

import { assertApiBase, httpErrorMessage } from '../config/apiBase'

export async function loginAndGetOpenId(role: 'candidate' | 'interviewer'): Promise<string> {
  const base = assertApiBase()
  const loginRes = await Taro.login()
  const code = loginRes.code || ''
  if (!code) throw new Error('获取微信登录 code 失败，请重开小程序再试')

  let res: Taro.request.SuccessCallbackResult<{ data: { openid: string } }>
  try {
    res = await Taro.request<{ data: { openid: string } }>({
      url: `${base}/api/wechat/login`,
      method: 'POST',
      data: { code, role }
    })
  } catch {
    throw new Error(
      `无法连接服务器 ${base}。请确认已运行 npm run dev:api；改 IP 后需重新执行 npm run dev:weapp，或在控制台执行 wx.setStorageSync('DEV_API_BASE','http://新IP:3001') 后重进小程序；真机勿用 127.0.0.1，并勾选不校验合法域名`
    )
  }
  if (res.statusCode >= 400 || !res.data?.data?.openid) {
    throw new Error(httpErrorMessage(res, '换取 openid 失败'))
  }
  return res.data.data.openid
}
