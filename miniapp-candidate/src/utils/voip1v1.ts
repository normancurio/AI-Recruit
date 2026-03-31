/** 与微信文档一致：https://developers.weixin.qq.com/miniprogram/dev/api/media/voip/wx.join1v1Chat.html */

export type VoipParticipant = { openid: string; nickname: string }

const wxApi = (globalThis as any).wx

/** 由一方调用即可发起双人通话；另一方需已执行 setEnable1v1Chat({ enable: true })，在系统界面接听 */
export function join1v1VideoChat(params: {
  caller: VoipParticipant
  listener: VoipParticipant
  success?: () => void
  fail?: (err?: unknown) => void
}): void {
  if (!wxApi?.join1v1Chat) {
    params.fail?.(new Error('join1v1Chat unavailable'))
    return
  }
  wxApi.join1v1Chat({
    caller: {
      openid: params.caller.openid,
      nickname: params.caller.nickname || '用户'
    },
    listener: {
      openid: params.listener.openid,
      nickname: params.listener.nickname || '用户'
    },
    roomType: 'video',
    minWindowType: 1,
    success: params.success,
    fail: params.fail
  })
}

export function setEnable1v1Chat(enable: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!wxApi?.setEnable1v1Chat) {
      resolve()
      return
    }
    wxApi.setEnable1v1Chat({
      enable,
      success: () => resolve(),
      fail: (e: unknown) => reject(e)
    })
  })
}
