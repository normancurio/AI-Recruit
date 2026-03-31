import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'

import { loginAndGetOpenId } from '../../services/authApi'
import { flowLog, flowLogInfo } from '../../utils/flowLog'

import './index.scss'

async function ensureWxOpenId() {
  const openid = await loginAndGetOpenId('candidate')
  Taro.setStorageSync('wx_openid', openid)
}

function formatBootError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '加载失败，请检查网络后重试'
}

export default function EntryPage() {
  const [tip, setTip] = useState('正在准备…')
  const [showRetry, setShowRetry] = useState(false)
  const bootGen = useRef(0)

  const goLogin = useCallback(() => {
    Taro.reLaunch({ url: '/pages/login/index' })
  }, [])

  const bootstrap = useCallback(async () => {
    const gen = ++bootGen.current
    setShowRetry(false)
    setTip('正在准备…')
    const cached = (Taro.getStorageSync('wx_openid') as string) || ''
    if (cached) {
      if (gen !== bootGen.current) return
      flowLogInfo('入口', '已有 wx_openid，跳转登录')
      goLogin()
      return
    }
    try {
      setTip('正在连接微信…')
      flowLogInfo('入口', '请求 loginAndGetOpenId')
      await ensureWxOpenId()
      if (gen !== bootGen.current) return
      flowLog('入口 换 openid', true)
      goLogin()
    } catch (e) {
      if (gen !== bootGen.current) return
      flowLog('入口 换 openid', false, e instanceof Error ? e.message : 'unknown')
      setTip(formatBootError(e))
      setShowRetry(true)
    }
  }, [goLogin])

  useDidShow(() => {
    void bootstrap()
  })

  return (
    <View className='safe-container entry-page'>
      <View className='card'>
        <Text className='title'>AI 面试</Text>
        <Text className='tip'>{tip}</Text>
        {showRetry ? (
          <Button className='retry-btn' onClick={() => void bootstrap()}>
            重试
          </Button>
        ) : null}
      </View>
    </View>
  )
}
