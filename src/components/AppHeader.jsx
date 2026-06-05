import { useNavigate } from 'react-router-dom'
import { Logo } from './ui'

export function BookshelfButton({ childId }) {
  const navigate = useNavigate()
  if (!childId) return null

  return (
    <button
      type="button"
      onClick={() => navigate(`/child/${childId}/bookshelf`)}
      style={{
        background: 'var(--gold-pale)',
        border: '1px solid rgba(200,136,42,0.25)',
        borderRadius: 'var(--radius-sm)',
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--ink-soft)',
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        whiteSpace: 'nowrap',
      }}
    >
      Bookshelf
    </button>
  )
}

export default function AppHeader({ childId, title, right }) {
  const navigate = useNavigate()

  return (
    <header style={{
      borderBottom: '1px solid var(--border)',
      background: 'var(--warm-white)',
      padding: '0 24px',
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 10,
    }}>
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        aria-label="Back to child selection"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Logo size="sm" />
      </button>

      {title && (
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--ink)',
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '40%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {title}
        </h1>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
        <BookshelfButton childId={childId} />
        {right}
      </div>
    </header>
  )
}
