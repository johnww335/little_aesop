import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getChildren, createChild, deleteChild, calculateAge, getAvatarEmoji, MAX_CHILDREN } from '../lib/children'
import { Button, Alert } from '../components/ui'
import AppHeader from '../components/AppHeader'
import AddChildModal from '../components/AddChildModal'
import OnboardingModal from '../components/OnboardingModal'
import { useOnboarding, ONBOARDING_STEPS } from '../lib/onboarding'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { show: showWelcome, dismiss: dismissWelcome } = useOnboarding(
    user?.id,
    ONBOARDING_STEPS.WELCOME,
    !loading,
  )

  useEffect(() => {
    loadChildren()
  }, [])

  const loadChildren = async () => {
    setLoading(true)
    const { data, error } = await getChildren(user.id)
    setLoading(false)
    if (error) { setError(error.message); return }
    setChildren(data || [])
  }

  const handleSaveChild = async (childData) => {
    const { error } = await createChild(user.id, childData)
    if (!error) await loadChildren()
    return { error }
  }

  const handleDeleteChild = async (child) => {
    if (confirmDelete?.id !== child.id) {
      setConfirmDelete(child)
      return
    }
    setDeletingId(child.id)
    setConfirmDelete(null)
    const { error } = await deleteChild(child.id, user.id)
    setDeletingId(null)
    if (error) { setError(error.message); return }
    setChildren(prev => prev.filter(c => c.id !== child.id))
  }

  const atLimit = children.length >= MAX_CHILDREN

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', backgroundImage: `radial-gradient(ellipse at 10% 0%, rgba(200,136,42,0.08) 0%, transparent 50%)` }}>
      {/* Header */}
      <AppHeader
        right={(
          <>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{user.email}</span>
            <Button variant="secondary" onClick={signOut} style={{ width: 'auto', padding: '6px 14px', fontSize: 13 }}>
              Sign out
            </Button>
          </>
        )}
      />

      {/* Main content */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
            Who's reading today?
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)' }}>
            Select a child to start a new story, or add a new reader to your family.
          </p>
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-muted)' }}>
            <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
            Loading profiles…
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {children.map(child => (
              <ChildCard
                key={child.id}
                child={child}
                onDelete={() => handleDeleteChild(child)}
                isDeleting={deletingId === child.id}
                confirmingDelete={confirmDelete?.id === child.id}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
            {!atLimit && (
              <button
                onClick={() => setShowModal(true)}
                style={{
                  background: 'var(--warm-white)',
                  border: '2px dashed var(--border-strong)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '32px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  transition: 'border-color 0.15s, background 0.15s',
                  minHeight: 160,
                  color: 'var(--ink-muted)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'var(--gold-pale)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--warm-white)' }}
              >
                <span style={{ fontSize: 28, lineHeight: 1 }}>+</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Add child</span>
              </button>
            )}
            {atLimit && (
              <div style={{ background: 'var(--gold-pale)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 16px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13, minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Maximum of {MAX_CHILDREN} profiles reached
              </div>
            )}
          </div>
        )}

        {children.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-muted)' }}>
            <p style={{ fontSize: 15, marginBottom: 4 }}>No children yet.</p>
            <p style={{ fontSize: 14 }}>Add a child profile to get started.</p>
          </div>
        )}

        {/* Profile count */}
        {children.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center', marginTop: 28 }}>
            {children.length} of {MAX_CHILDREN} profiles used
          </p>
        )}
      </main>

      {showWelcome && (
        <OnboardingModal title="Welcome to Little Aesop!" onDismiss={dismissWelcome}>
          <p style={{ marginBottom: 12 }}>
            Little Aesop creates personalized bedtime stories for your children. You answer a few
            fun questions, and we write and illustrate a unique story just for them.
          </p>
          <p style={{ margin: 0 }}>
            Start by adding a child profile below, then open their bookshelf to create your first story.
          </p>
        </OnboardingModal>
      )}

      {showModal && (
        <AddChildModal
          onClose={() => setShowModal(false)}
          onSave={handleSaveChild}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  )
}

function ChildCard({ child, onDelete, isDeleting, confirmingDelete, onCancelDelete }) {
  const navigate = useNavigate()
  const age = calculateAge(child.birthday)
  const emoji = getAvatarEmoji(child.gender, child.name)

  const openBookshelf = () => navigate(`/child/${child.id}/bookshelf`)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !confirmingDelete && openBookshelf()}
      onKeyDown={e => {
        if ((e.key === 'Enter' || e.key === ' ') && !confirmingDelete) {
          e.preventDefault()
          openBookshelf()
        }
      }}
      style={{
      background: 'var(--warm-white)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '24px 16px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      position: 'relative',
      boxShadow: 'var(--shadow-sm)',
      transition: 'box-shadow 0.15s, transform 0.15s',
      cursor: 'pointer'
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {/* Avatar */}
      <div style={{
        width: 64, height: 64,
        background: 'var(--gold-pale)',
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32,
        border: '2px solid var(--border)'
      }}>
        {emoji}
      </div>

      {/* Name & age */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)', marginBottom: 2 }}>
          {child.name}
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          {age === 1 ? '1 year old' : `${age} years old`}
        </p>
      </div>

      {/* Open bookshelf */}
      <span
        style={{ background: 'var(--gold-pale)', borderRadius: 99, padding: '4px 12px', fontSize: 12, color: 'var(--gold)', fontWeight: 600, marginTop: 4 }}
      >
        Open bookshelf →
      </span>

      {/* Delete */}
      {confirmingDelete ? (
        <div style={{ width: '100%', marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <p style={{ fontSize: 12, color: 'var(--rose)', textAlign: 'center', marginBottom: 6 }}>Remove {child.name}?</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="secondary" onClick={onCancelDelete} style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}>Cancel</Button>
            <Button variant="danger" onClick={onDelete} loading={isDeleting} style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}>Remove</Button>
          </div>
        </div>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          disabled={isDeleting}
          style={{
            position: 'absolute', top: 10, right: 10,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--ink-muted)', fontSize: 16, lineHeight: 1,
            opacity: 0.5, transition: 'opacity 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
          title={`Remove ${child.name}`}
        >
          ×
        </button>
      )}
    </div>
  )
}
