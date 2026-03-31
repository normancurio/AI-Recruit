import type TrtcWx from 'trtc-wx-sdk'

/** 尝试经 TRTC live-pusher 发送自定义消息（失败静默） */
export function trySendTrtcPusherCustomMessage(trtc: InstanceType<typeof TrtcWx> | null, text: string) {
  if (!trtc || !text) return
  try {
    const pi = trtc.getPusherInstance() as { sendMessage?: (opts: { msgType?: number; data?: string }) => void } | null
    pi?.sendMessage?.({ msgType: 1, data: String(text).slice(0, 800) })
  } catch {
    /* ignore */
  }
}
