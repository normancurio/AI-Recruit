import Taro from '@tarojs/taro'
import { useMemo } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { InterviewResult } from '../../types/interview'

import './index.scss'

export default function ResultPage() {
  const result = useMemo(() => {
    return (Taro.getStorageSync('interview_result') as InterviewResult | undefined) || null
  }, [])

  const handleBackHome = () => {
    Taro.removeStorageSync('candidate_profile')
    Taro.removeStorageSync('candidate_job')
    Taro.removeStorageSync('interview_result')
    Taro.reLaunch({ url: '/pages/login/index' })
  }

  return (
    <View className='safe-container result-page'>
      <View className='card'>
        <Text className='title'>初试完成</Text>
        {result && (
          <Text className='score'>
            综合评分：{result.score} 分（{result.passed ? '建议通过' : '待定'}）
          </Text>
        )}
        <Text className='desc'>
          {result?.overallFeedback || '面试记录已提交，HR 将在 1-3 个工作日内联系你安排下一轮。'}
        </Text>

        <Button className='primary-btn' onClick={handleBackHome}>
          返回首页
        </Button>
      </View>
    </View>
  )
}
