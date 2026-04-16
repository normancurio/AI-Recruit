import { PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'
import './app.scss'

try {
  const wx = Taro as unknown as { setInnerAudioOption?: (o: { obeyMuteSwitch?: boolean }) => void }
  wx.setInnerAudioOption?.({ obeyMuteSwitch: false })
} catch {
  /* 低版本基础库无此方法 */
}

function App({ children }: PropsWithChildren) {
  return children
}

export default App
