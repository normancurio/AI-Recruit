import Taro from '@tarojs/taro'

import { AI_INTERVIEWER_IMG_URL } from '../config/aiInterviewerImgUrl'
import {
  getOpeningVideoUrl,
  getUmmVideoUrl,
  OPENING_VIDEO_CACHE_KEY,
  UMM_VIDEO_CACHE_KEY
} from '../config/digitalHumanVideo'

export const AI_INTERVIEWER_IMG_CACHE_KEY = 'ai_interviewer_img_cache_v1'

function preloadOne(url: string, cacheKey: string): Promise<string> {
  return new Promise((resolve) => {
    if (!url) {
      resolve('')
      return
    }
    // 同一会话内已下载过则直接复用临时路径，避免重复下载。
    try {
      const cached = Taro.getStorageSync(cacheKey) as string
      if (cached) {
        resolve(cached)
        return
      }
    } catch {
      /* ignore */
    }
    if (typeof Taro.downloadFile !== 'function') {
      // H5 等环境无 downloadFile：交给 <video preload> / 浏览器缓存即可。
      resolve('')
      return
    }
    Taro.downloadFile({
      url,
      success: (res) => {
        const path = (res as { tempFilePath?: string }).tempFilePath || ''
        if (res.statusCode === 200 && path) {
          try {
            Taro.setStorageSync(cacheKey, path)
          } catch {
            /* ignore */
          }
          resolve(path)
        } else {
          resolve('')
        }
      },
      fail: () => resolve('')
    })
  })
}

/**
 * 提前下载数字人视频、面试官 PNG，供面试页直接使用本地缓存。
 */
export function preloadDigitalHumanVideos(): void {
  void Promise.all([
    preloadOne(getOpeningVideoUrl(), OPENING_VIDEO_CACHE_KEY),
    preloadOne(getUmmVideoUrl(), UMM_VIDEO_CACHE_KEY)
  ])
}

export function preloadInterviewerAvatar(): void {
  void preloadOne(AI_INTERVIEWER_IMG_URL, AI_INTERVIEWER_IMG_CACHE_KEY)
}

/** 登录/候场：视频 + 静态头像一并预载 */
export function preloadInterviewAssets(): void {
  preloadDigitalHumanVideos()
  preloadInterviewerAvatar()
}
