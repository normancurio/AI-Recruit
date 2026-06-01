import { useEffect, useRef, useState } from 'react'

import { enterTrtcPublisher, resolveTrtcCredential, type TrtcPublisher } from '../adapters/trtcWeb'
import CameraPreview from './CameraPreview'

type Props = {
  sessionId: string
  userId: string
  active?: boolean
  onError?: (message: string) => void
  onPublisherReady?: (publisher: TrtcPublisher | null) => void
}

type CameraMode = 'loading' | 'trtc' | 'fallback'

export default function InterviewCamera({
  sessionId,
  userId,
  active = true,
  onError,
  onPublisherReady
}: Props) {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const publisherRef = useRef<TrtcPublisher | null>(null)
  const onErrorRef = useRef(onError)
  const onReadyRef = useRef(onPublisherReady)
  onErrorRef.current = onError
  onReadyRef.current = onPublisherReady

  const [mode, setMode] = useState<CameraMode>('loading')
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!active || !sessionId || !userId) return undefined
    let cancelled = false

    const boot = async () => {
      setMode('loading')
      setHint('')
      try {
        const cred = await resolveTrtcCredential(sessionId, userId)
        if (cancelled) return
        if (!cred) {
          setMode('fallback')
          setHint('未配置 TRTC，使用本机摄像头预览')
          onReadyRef.current?.(null)
          return
        }
        const view = viewRef.current
        if (!view) {
          await new Promise<void>((r) => {
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          })
        }
        const mount = viewRef.current
        if (!mount) {
          setMode('fallback')
          onReadyRef.current?.(null)
          return
        }
        const publisher = await enterTrtcPublisher({ credential: cred, view: mount })
        if (cancelled) {
          await publisher.exit()
          return
        }
        publisherRef.current = publisher
        setMode('trtc')
        setHint('TRTC 视频已推流')
        onReadyRef.current?.(publisher)
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'TRTC 进房失败'
        setMode('fallback')
        setHint(msg)
        onErrorRef.current?.(`${msg}，已改用本机摄像头预览`)
        onReadyRef.current?.(null)
      }
    }

    void boot()
    return () => {
      cancelled = true
      const pub = publisherRef.current
      publisherRef.current = null
      onReadyRef.current?.(null)
      if (pub) void pub.exit()
    }
  }, [active, sessionId, userId])

  if (mode === 'fallback') {
    return (
      <div>
        <CameraPreview active={active} onError={(msg) => onErrorRef.current?.(msg)} />
        {hint ? <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>{hint}</p> : null}
      </div>
    )
  }

  return (
    <div className="camera-preview">
      <div ref={viewRef} className="camera-preview__trtc-view" />
      {mode === 'loading' ? (
        <div className="camera-preview__loading">正在连接实时视频…</div>
      ) : null}
      <span className="camera-preview__badge">我</span>
      {hint ? <span className="camera-preview__trtc-hint">{hint}</span> : null}
    </div>
  )
}
