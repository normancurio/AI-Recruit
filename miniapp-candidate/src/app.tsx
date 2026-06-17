import { PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'
import { preloadInterviewAssets } from './utils/digitalHumanPreload'
import './app.scss'

try {
  const wx = Taro as unknown as { setInnerAudioOption?: (o: { obeyMuteSwitch?: boolean }) => void }
  wx.setInnerAudioOption?.({ obeyMuteSwitch: false })
} catch {
  /* 低版本基础库无此方法 */
}

function App({ children }: PropsWithChildren) {
  Taro.useLaunch(() => {
    preloadInterviewAssets()
  })
  return children
}

export default App
