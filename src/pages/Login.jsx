import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { AuthCard, FormField, Input, Button, Alert } from '../components/ui'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/dashboard'

  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)

  const validate = () => {
    const e = {}
    if (!form.email) e.email = 'Email is required'
    if (!form.password) e.password = 'Password is required'
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setApiError('')
    setLoading(true)
    const { error } = await signIn(form.email, form.password)
    setLoading(false)
    if (error) {
      setApiError(error.message === 'Invalid login credentials'
        ? 'Incorrect email or password. Please try again.'
        : error.message)
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to continue the adventure">
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
            id="password" type="password" placeholder="Your password"
            value={form.password} error={errors.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          />
        </FormField>
        <div style={{ textAlign: 'right', marginTop: -10, marginBottom: 18 }}>
          <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={loading}>
          Sign in
        </Button>
        <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--ink-muted)', marginTop: 20 }}>
          New here? <Link to="/signup">Create an account</Link>
          {' · '}
          <Link to="/" style={{ color: 'var(--ink-muted)', fontWeight: 600 }}>About Little Aesop</Link>
        </p>
      </form>
    </AuthCard>
  )
}
