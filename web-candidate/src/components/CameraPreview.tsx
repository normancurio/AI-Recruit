import { useEffect, useRef } from 'react'

type Props = {
  active?: boolean
  onError?: (message: string) => void
}

export default function CameraPreview({ active = true, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
        }
      } catch {
        onError?.('无法打开摄像头，请在浏览器设置中允许相机权限')
      }
    }

    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      const video = videoRef.current
      if (video) video.srcObject = null
    }
  }, [active, onError])

  return (
    <div className="camera-preview">
      <video ref={videoRef} className="camera-preview__video" playsInline muted autoPlay />
      <span className="camera-preview__badge">我</span>
    </div>
  )
}
