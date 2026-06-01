import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { prefetchInterviewQuestions } from '../services/interviewApi'
import type { CandidateProfile, JobInfo } from '../types/interview'
import { warmupCameraAndMic } from '../utils/media'
import { primeSpeechSynthesis } from '../utils/speech'
import { getJob, getProfile } from '../utils/storage'

async function warmupMedia() {
  await warmupCameraAndMic()
}

export default function LobbyPage() {
  const navigate = useNavigate()
  const [profile, setProfileState] = useState<CandidateProfile | null>(null)
  const [job, setJobState] = useState<JobInfo | null>(null)

  useEffect(() => {
    const p = getProfile()
    const j = getJob()
    if (!p?.name || !p.inviteCode || !j?.id) {
      navigate('/', { replace: true })
      return
    }
    setProfileState(p)
    setJobState(j)
    prefetchInterviewQuestions(
      j.id,
      p.name,
      typeof p.resumeScreeningId === 'number' ? p.resumeScreeningId : undefined
    )
  }, [navigate])

  const enterInterview = async () => {
    if (!profile || !job) return
    primeSpeechSynthesis()
    await warmupMedia()
    navigate('/interview')
  }

  return (
    <div className="page">
      <header style={{ marginBottom: 20 }}>
        <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>面试准备</p>
        <h1 style={{ margin: '6px 0', fontSize: 28 }}>{profile?.name || '候选人'}，你好</h1>
        <p style={{ margin: 0, fontSize: 16 }}>「{job?.title || '待定'}」</p>
      </header>

      <div className="card">
        <p>
          欢迎参加「{job?.title || '待定'}」的 AI 面试。建议使用 Chrome / Edge，并允许浏览器使用摄像头与麦克风。
        </p>
        <ul style={{ color: '#64748b', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>请在安静、光线充足的环境下进行</li>
          <li>题目由大模型根据 JD 与简历生成</li>
          <li>请口述作答，浏览器会将语音转写为文字（不支持时可手动输入）</li>
        </ul>
        <button className="btn-primary" type="button" onClick={() => void enterInterview()}>
          进入 AI 面试
        </button>
      </div>
    </div>
  )
}
