import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AuthCard, FormField, Input, Button, Alert } from '../components/ui'

export function ForgotPassword() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email) { setError('Please enter your email address'); return }
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Enter a valid email address'); return }
    setError('')
    setLoading(true)
    const { error: apiError } = await resetPassword(email)
    setLoading(false)
    if (apiError) { setError(apiError.message); return }
    setSent(true)
  }

  if (sent) {
    return (
      <AuthCard title="Email sent" subtitle={`Password reset instructions sent to ${email}`}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 24, lineHeight: 1.6 }}>
            Check your inbox for a link to reset your password. The link will expire in 1 hour.
          </p>
          <Link to="/login">
            <Button variant="secondary" style={{ width: 'auto', margin: '0 auto' }}>Back to sign in</Button>
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a reset link">
      <form onSubmit={handleSubmit} noValidate>
        {error && <Alert type="error">{error}</Alert>}
        <FormField label="Email address" id="email" error={error && email ? '' : undefined}>
          <Input
            id="email" type="email" placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </FormField>
        <Button type="submit" loading={loading}>
          Send reset link
        </Button>
        <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--ink-muted)', marginTop: 20 }}>
          <Link to="/login">← Back to sign in</Link>
        </p>
      </form>
    </AuthCard>
  )
}

export function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)

  const validate = () => {
    const e = {}
    if (!form.password) e.password = 'Password is required'
    else if (form.password.length < 8) e.password = 'Password must be at least 8 characters'
    if (!form.confirm) e.confirm = 'Please confirm your password'
    else if (form.confirm !== form.password) e.confirm = 'Passwords do not match'
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setApiError('')
    setLoading(true)
    const { error } = await updatePassword(form.password)
    setLoading(false)
    if (error) { setApiError(error.message); return }
    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Make it something memorable">
      <form onSubmit={handleSubmit} noValidate>
        {apiError && <Alert type="error">{apiError}</Alert>}
        <FormField label="New password" id="password" error={errors.password}>
          <Input
            id="password" type="password" placeholder="At least 8 characters"
            value={form.password} error={errors.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          />
        </FormField>
        <FormField label="Confirm new password" id="confirm" error={errors.confirm}>
          <Input
            id="confirm" type="password" placeholder="Repeat your new password"
            value={form.confirm} error={errors.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
          />
        </FormField>
        <Button type="submit" loading={loading}>
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}
