/**
 * 数字人面试官视频（托管在阿里云 OSS，公开读）。
 * - opening（开场）：系统播报（AI 读题）时循环播放，模拟数字人说话。
 * - umm（嗯）：候选人作答时静音播放，播完一次延迟几秒再循环。
 *
 * 注意：微信小程序的 <video> 与 downloadFile 都要求该 OSS 域名加入
 * 「downloadFile 合法域名」白名单（已在小程序后台配置）。
 */
const OPENING_VIDEO_URL = 'https://ai-mianshi-h.oss-cn-hangzhou.aliyuncs.com/%E5%BC%80%E5%9C%BA.mp4'
const UMM_VIDEO_URL = 'https://ai-mianshi-h.oss-cn-hangzhou.aliyuncs.com/%E5%97%AF.mp4'

export function getOpeningVideoUrl(): string {
  return OPENING_VIDEO_URL
}

export function getUmmVideoUrl(): string {
  return UMM_VIDEO_URL
}

/** 缓存键：login（邀请码）页预下载后写入小程序本地缓存的临时文件路径（_oss 后缀避免复用旧本地路径） */
export const OPENING_VIDEO_CACHE_KEY = 'dh_opening_video_path_oss'
export const UMM_VIDEO_CACHE_KEY = 'dh_umm_video_path_oss'
