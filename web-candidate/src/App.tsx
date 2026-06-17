import { Navigate, Route, Routes } from 'react-router-dom'
import InterviewPage from './pages/InterviewPage'
import LobbyPage from './pages/LobbyPage'
import LoginPage from './pages/LoginPage'
import ResultPage from './pages/ResultPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/lobby" element={<LobbyPage />} />
      <Route path="/interview" element={<InterviewPage />} />
      <Route path="/result" element={<ResultPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
