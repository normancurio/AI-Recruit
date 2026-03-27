import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Text, View } from '@tarojs/components'

import { loginAndGetOpenId } from '../../services/authApi'
import { getMyProfile } from '../../services/userApi'

import './index.scss'

export default function EntryPage() {
  const [tip, setTip] = useState('正在登录...')

  useDidShow(async () => {
    try {
      const openid = await loginAndGetOpenId('candidate')
      Taro.setStorageSync('wx_openid', openid)
      setTip('正在加载身份信息...')

      const me = await getMyProfile(openid)
      if (me.role === 'interviewer') {
        Taro.reLaunch({ url: '/pages/interviewer/index' })
        return
      }
      Taro.reLaunch({ url: '/pages/login/index' })
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'errMsg' in e
            ? String((e as { errMsg: string }).errMsg)
            : '登录失败，请稍后重试'
      setTip(msg)
    }
  })

  return (
    <View className='safe-container entry-page'>
      <View className='card'>
        <Text className='title'>AI 面试</Text>
        <Text className='tip'>{tip}</Text>
      </View>
    </View>
  )
}

