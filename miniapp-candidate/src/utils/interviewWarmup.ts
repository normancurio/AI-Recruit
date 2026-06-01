import Taro from '@tarojs/taro'

import {
  buildInterviewQuestionsCacheKey,
  prefetchInterviewQuestions
} from '../services/interviewApi'
import { flowLog, flowLogInfo } from './flowLog'
import { prefetchInterviewQuestionTtsPath, type RequirePluginFn } from './interviewQuestionTts'

const FIRST_QUESTION_TTS_STORAGE_KEY = 'interview_first_question_tts_v1'

function getWechatSiRequirePlugin(): RequirePluginFn | null {
  const fn = (globalThis as { requirePlugin?: (name: string) => unknown }).requirePlugin
  return typeof fn === 'function' ? (fn as RequirePluginFn) : null
}

/**
 * 登录成功 / 候场页：后台拉题 + 首题读题 TTS 预生成，缩短进入面试页等待。
 */
export function prefetchInterviewWarmup(params: {
  jobId: string
  candidateName: string
  resumeScreeningId?: number
}): Promise<unknown> {
  const key = buildInterviewQuestionsCacheKey(
    params.jobId,
    params.candidateName,
    params.resumeScreeningId
  )
  const questionsPromise = prefetchInterviewQuestions(
    params.jobId,
    params.candidateName,
    params.resumeScreeningId
  )

  const requirePlugin = getWechatSiRequirePlugin()
  if (!requirePlugin) return questionsPromise

  void questionsPromise
    .then((questions) => {
      const q0 = String(questions?.[0]?.text || '').trim()
      if (!q0) return
      prefetchInterviewQuestionTtsPath(q0, requirePlugin, (path) => {
        if (!path) return
        try {
          Taro.setStorageSync(FIRST_QUESTION_TTS_STORAGE_KEY, {
            cacheKey: key,
            path,
            at: Date.now()
          })
          flowLogInfo('面试预热', '首题读题音频已预拉取')
        } catch {
          /* ignore */
        }
      })
    })
    .catch((e) => {
      flowLog('面试预热', false, e instanceof Error ? e.message : 'prefetch failed')
    })

  return questionsPromise
}

/** 面试页消费候场预拉的首题 TTS 路径（命中则删除缓存，避免串场） */
export function consumePrefetchedFirstQuestionTts(cacheKey: string): string {
  try {
    const raw = Taro.getStorageSync(FIRST_QUESTION_TTS_STORAGE_KEY) as
      | { cacheKey?: string; path?: string }
      | undefined
    if (raw?.cacheKey === cacheKey && raw.path) {
      Taro.removeStorageSync(FIRST_QUESTION_TTS_STORAGE_KEY)
      return raw.path
    }
  } catch {
    /* ignore */
  }
  return ''
}
