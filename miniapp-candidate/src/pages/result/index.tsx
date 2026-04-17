import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'

import './index.scss'

export default function ResultPage() {
  const handleBackHome = () => {
    Taro.removeStorageSync('candidate_profile')
    Taro.removeStorageSync('candidate_job')
    Taro.removeStorageSync('interview_result')
    Taro.reLaunch({ url: '/pages/login/index' })
  }

  return (
    <View className='safe-container result-page'>
      <View className='card'>
        <Text className='title'>感谢参加面试</Text>
        <Text className='desc'>
          你的作答已提交。HR 将在 1-3 个工作日内视情况与你联系，请留意消息。
        </Text>

        <Button className='primary-btn' onClick={handleBackHome}>
          返回首页
        </Button>
      </View>
    </View>
  )
}
