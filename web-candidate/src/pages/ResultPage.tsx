import { useNavigate } from 'react-router-dom'
import { clearSession } from '../utils/storage'

export default function ResultPage() {
  const navigate = useNavigate()

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 560, textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>感谢参加面试</h1>
        <p style={{ color: '#64748b' }}>
          你的作答已提交。HR 将在 1-3 个工作日内视情况与你联系，请留意消息。
        </p>
        <button
          className="btn-primary"
          type="button"
          onClick={() => {
            clearSession()
            navigate('/', { replace: true })
          }}
        >
          返回首页
        </button>
      </div>
    </div>
  )
}
