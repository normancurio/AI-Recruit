/** 在用户点击链路内预申请麦克风，后续读题后转写不再被权限策略拦住 */
export async function ensureMicPermission(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

export async function warmupCameraAndMic(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch {
    /* 面试页会再提示 */
  }
}
