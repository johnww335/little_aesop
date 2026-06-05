import { Link } from 'react-router-dom'
import { AuthCard, Button } from '../components/ui'

export default function VerifyEmail() {
  return (
    <AuthCard title="Email verified!" subtitle="Your account is ready to go">
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
        <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 24, lineHeight: 1.6 }}>
          Your email has been confirmed. Sign in to create child profiles and start building stories.
        </p>
        <Link to="/login">
          <Button style={{ width: 'auto', margin: '0 auto', padding: '10px 32px' }}>
            Sign in now
          </Button>
        </Link>
      </div>
    </AuthCard>
  )
}
