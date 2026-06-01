import Taro from '@tarojs/taro'

import {
  getOpeningVideoUrl,
  getUmmVideoUrl,
  OPENING_VIDEO_CACHE_KEY,
  UMM_VIDEO_CACHE_KEY
} from '../config/digitalHumanVideo'

let preloading = false

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
 * 在邀请码页提前下载数字人视频并缓存临时路径，
 * 让面试页直接用本地缓存播放，避免进入面试页时因视频未加载而卡顿。
 */
export function preloadDigitalHumanVideos(): void {
  if (preloading) return
  preloading = true
  void Promise.all([
    preloadOne(getOpeningVideoUrl(), OPENING_VIDEO_CACHE_KEY),
    preloadOne(getUmmVideoUrl(), UMM_VIDEO_CACHE_KEY)
  ]).finally(() => {
    preloading = false
  })
}
