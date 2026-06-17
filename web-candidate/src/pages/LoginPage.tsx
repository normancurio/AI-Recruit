import { FormEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginWithInviteCodeH5 } from '../services/interviewApi'
import { setJob, setOpenId, setProfile, setSessionId, setTrtcCredential } from '../utils/storage'

export default function LoginPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = useMemo(
    () => Boolean(name.trim() && phone.trim() && inviteCode.trim()),
    [inviteCode, name, phone]
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const code = inviteCode.trim().toUpperCase()
    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      setError('请输入真实姓名（至少2个字）')
      return
    }
    if (code.length < 4 || code.length > 128) {
      setError('邀请码须 4～128 位')
      return
    }
    if (!/^[A-Z0-9_.@-]+$/.test(code)) {
      setError('邀请码仅字母数字及 -_.@')
      return
    }
    const phoneTrimmed = phone.replace(/\D/g, '').trim()
    if (!/^1[3-9]\d{9}$/.test(phoneTrimmed)) {
      setError('请输入本人11位手机号')
      return
    }
    try {
      setLoading(true)
      const data = await loginWithInviteCodeH5({
        inviteCode: code,
        name: trimmedName,
        phone: phoneTrimmed
      })
      setOpenId(data.openid)
      setSessionId(data.sessionId)
      setTrtcCredential(data.trtc ?? null)
      const profile = {
        name: data.name,
        phone: phoneTrimmed,
        inviteCode: code,
        openid: data.openid,
        ...(typeof data.resumeScreeningId === 'number' && data.resumeScreeningId > 0
          ? { resumeScreeningId: data.resumeScreeningId }
          : {})
      }
      setProfile(profile)
      setJob(data.job)
      navigate('/lobby')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 32 }}>AI 面试 · PC 版</h1>
        <p style={{ margin: 0, color: '#64748b' }}>
          请使用 Chrome / Edge，填写与简历一致的姓名和手机号
        </p>
      </header>

      <form className="card" style={{ maxWidth: 520 }} onSubmit={handleSubmit}>
        <div className="field">
          <label>
            姓名<span className="required">*</span>
          </label>
          <input value={name} placeholder="请输入真实姓名" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>
            手机号<span className="required">*</span>
          </label>
          <input
            value={phone}
            placeholder="请输入手机号"
            maxLength={11}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
          />
        </div>
        <div className="field">
          <label>
            邀请码<span className="required">*</span>
          </label>
          <input
            value={inviteCode}
            placeholder="HR 提供的岗位码，演示可填 J001"
            onChange={(e) => setInviteCode(e.target.value)}
          />
          <p className="field-hint">测试岗位码示例：J001</p>
        </div>
        {error ? <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={!canSubmit || loading}>
          {loading ? '登录中…' : '下一步'}
        </button>
      </form>
    </div>
  )
}
