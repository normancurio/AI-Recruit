declare module 'trtc-wx-sdk' {
  type TrtcPageCtx = Record<string, unknown>
  export default class TRTC {
    EVENT: Record<string, string>
    constructor(ctx: TrtcPageCtx, options?: { TUIScene?: string; env?: string })
    createPusher(config?: Record<string, unknown>): { pusherAttributes: Record<string, unknown> }
    enterRoom(options: Record<string, unknown>): Record<string, unknown>
    exitRoom(): Record<string, unknown>
    getPusherInstance(): {
      start: (opts?: Record<string, unknown>) => void
      stop: (opts?: Record<string, unknown>) => void
    } | null
    getPusherAttributes(): Record<string, unknown>
    getPlayerList(): Record<string, unknown>[]
    on(event: string, cb: (...args: unknown[]) => void, ctx?: unknown): void
    pusherEventHandler(e: unknown): void
    pusherNetStatusHandler(e: unknown): void
    pusherErrorHandler(e: unknown): void
    pusherBGMStartHandler(e: unknown): void
    pusherBGMProgressHandler(e: unknown): void
    pusherBGMCompleteHandler(e: unknown): void
    pusherAudioVolumeNotify(e: unknown): void
    playerEventHandler(e: unknown): void
    playerFullscreenChange(e: unknown): void
    playerNetStatus(e: unknown): void
    playerAudioVolumeNotify(e: unknown): void
  }
}
