import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { AuthCard, FormField, Input, Button, Alert } from '../components/ui'

export default function SignUp() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const validate = () => {
    const e = {}
    if (!form.email) e.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email'
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
    const { error } = await signUp(form.email, form.password)
    setLoading(false)
    if (error) { setApiError(error.message); return }
    setSuccess(true)
  }

  if (success) {
    return (
      <AuthCard title="Check your inbox" subtitle={`We've sent a confirmation link to ${form.email}`}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 24, lineHeight: 1.6 }}>
            Click the link in the email to verify your account. Once verified, you can sign in and start creating stories.
          </p>
          <Link to="/login">
            <Button variant="secondary" style={{ width: 'auto', margin: '0 auto' }}>Back to sign in</Button>
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account" subtitle="Set up a parent account to get started">
      <form onSubmit={handleSubmit} noValidate>
        {apiError && <Alert type="error">{apiError}</Alert>}
        <FormField label="Email address" id="email" error={errors.email}>
          <Input
            id="email" type="email" placeholder="you@example.com"
            value={form.email} error={errors.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
        </FormField>
        <FormField label="Password" id="password" error={errors.password}>
          <Input
            id="password" type="password" placeholder="At least 8 characters"
            value={form.password} error={errors.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          />
        </FormField>
        <FormField label="Confirm password" id="confirm" error={errors.confirm}>
          <Input
            id="confirm" type="password" placeholder="Repeat your password"
            value={form.confirm} error={errors.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
          />
        </FormField>
        <Button type="submit" loading={loading} style={{ marginTop: 8 }}>
          Create account
        </Button>
        <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--ink-muted)', marginTop: 20 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthCard>
  )
}
