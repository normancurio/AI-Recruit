import TRTC from 'trtc-sdk-v5'

import { fetchTrtcCredential } from '../services/interviewApi'
import type { TrtcCredential } from '../types/trtc'
import { getSessionId, getTrtcCredential, setTrtcCredential } from '../utils/storage'

const TRTC_ENTER_TIMEOUT_MS = 12000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label}超时`)), ms)
    promise
      .then((v) => {
        window.clearTimeout(timer)
        resolve(v)
      })
      .catch((e) => {
        window.clearTimeout(timer)
        reject(e)
      })
  })
}

export type TrtcPublisher = {
  sendSubtitle: (text: string) => void
  exit: () => Promise<void>
}

export async function resolveTrtcCredential(
  sessionId: string,
  userId: string
): Promise<TrtcCredential | null> {
  const cached = getTrtcCredential()
  if (cached?.sdkAppId && cached.userSig && getSessionId() === sessionId) {
    return cached
  }
  const cred = await fetchTrtcCredential({ sessionId, userId })
  if (cred) setTrtcCredential(cred)
  return cred
}

/** 进房并仅推视频（麦克风留给 ASR），对齐小程序 TRTC enableMic:false */
export async function enterTrtcPublisher(params: {
  credential: TrtcCredential
  view: HTMLElement
}): Promise<TrtcPublisher> {
  const trtc = TRTC.create()
  await withTimeout(
    trtc.enterRoom({
      roomId: params.credential.roomId,
      sdkAppId: params.credential.sdkAppId,
      userId: params.credential.userId,
      userSig: params.credential.userSig,
      autoReceiveAudio: false,
      autoReceiveVideo: false
    }),
    TRTC_ENTER_TIMEOUT_MS,
    'TRTC 进房'
  )
  await withTimeout(
    trtc.startLocalVideo({
      view: params.view,
      option: { useFrontCamera: true, profile: '480p' }
    }),
    TRTC_ENTER_TIMEOUT_MS,
    'TRTC 开启摄像头'
  )

  return {
    sendSubtitle: (text: string) => {
      try {
        const t = String(text || '').trim().slice(0, 800)
        if (!t) return
        trtc.sendCustomMessage({
          cmdId: 1,
          data: new TextEncoder().encode(t).buffer
        })
      } catch {
        /* ignore */
      }
    },
    exit: async () => {
      try {
        await trtc.stopLocalVideo()
        await trtc.exitRoom()
      } catch {
        /* ignore */
      }
      trtc.destroy()
    }
  }
}
