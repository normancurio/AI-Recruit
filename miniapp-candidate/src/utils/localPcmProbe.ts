import Taro from '@tarojs/taro'

export type PcmProbeFrameInfo = { frameIndex: number; byteLength: number; totalBytes: number }

export type PcmProbeStopInfo = { frames: number; totalBytes: number }

/**
 * 本机麦克风 PCM 分帧试采（用于真机验证是否与 1v1 VoIP 等抢麦场景冲突）。
 * 官方：frameSize 单位为 KB；分帧回调暂仅支持 mp3、pcm。
 * @see https://developers.weixin.qq.com/miniprogram/dev/api/media/recorder/RecorderManager.start.html
 */
export function startLocalPcmProbe(opts: {
  /** 分帧大小，单位 KB，约 2KB ≈ 64ms@16kHz/mono/16bit */
  frameSizeKb?: number
  onFrame?: (info: PcmProbeFrameInfo) => void
  onError?: (errMsg: string) => void
  onStop?: (info: PcmProbeStopInfo) => void
}): { stop: () => void } {
  const { frameSizeKb = 2, onFrame, onError, onStop } = opts
  const rm = Taro.getRecorderManager()
  let frames = 0
  let totalBytes = 0

  rm.onFrameRecorded((res: { frameBuffer?: ArrayBuffer; isLastFrame?: boolean }) => {
    const buf = res.frameBuffer
    const len = buf?.byteLength ?? 0
    if (len <= 0) return
    frames += 1
    totalBytes += len
    onFrame?.({ frameIndex: frames, byteLength: len, totalBytes })
  })

  rm.onError((res: { errMsg?: string }) => {
    onError?.(res.errMsg || '录音失败')
  })

  rm.onStop(() => {
    onStop?.({ frames, totalBytes })
  })

  rm.start({
    duration: 600000,
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 96000,
    format: 'PCM',
    frameSize: frameSizeKb
  })

  return {
    stop: () => {
      try {
        rm.stop()
      } catch {
        /* ignore */
      }
    }
  }
}
