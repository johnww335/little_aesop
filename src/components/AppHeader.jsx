import { useNavigate } from 'react-router-dom'
import { Logo } from './ui'

export function BookshelfButton({ childId }) {
  const navigate = useNavigate()
  if (!childId) return null

  return (
    <button
      type="button"
      className="app-header-bookshelf"
      onClick={() => navigate(`/child/${childId}/bookshelf`)}
    >
      Bookshelf
    </button>
  )
}

export default function AppHeader({ childId, title, right }) {
  const navigate = useNavigate()

  return (
    <header
      className={`app-header${title ? ' app-header--has-title' : ''}`}
    >
      <div className="app-header-start">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          aria-label="Back to child selection"
          className="app-header-logo-btn"
        >
          <Logo size="sm" to="/dashboard" />
        </button>
      </div>

      {title ? (
        <h1 className="app-header-title">
          {title}
        </h1>
      ) : (
        <div className="app-header-title-spacer" aria-hidden="true" />
      )}

      <div className="app-header-end">
        <BookshelfButton childId={childId} />
        {right}
      </div>
    </header>
  )
}
