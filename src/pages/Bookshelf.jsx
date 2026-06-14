import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getStoriesForChild, deleteStory, STORY_PAGE_COUNT, computeIllustrationProgress, formatStoryFailureSummary, getIllustrationTargetFromEnv } from '../lib/stories'
import { getChildren, getAvatarEmoji } from '../lib/children'
import { Button, Alert } from '../components/ui'
import AppHeader from '../components/AppHeader'
import OnboardingModal from '../components/OnboardingModal'
import { useOnboarding, ONBOARDING_STEPS } from '../lib/onboarding'

export default function Bookshelf() {
  const { childId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stories, setStories] = useState([])
  const [child, setChild] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [storyToDelete, setStoryToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const { show: showBookshelfIntro, dismiss: dismissBookshelfIntro } = useOnboarding(
    user?.id,
    ONBOARDING_STEPS.BOOKSHELF,
    !loading && !!child,
  )

  useEffect(() => {
    loadData()
  }, [childId])

  useEffect(() => {
    const hasInProgress = stories.some(s => s.status === 'pending' || s.status === 'generating')
    if (!hasInProgress) return

    const interval = setInterval(() => loadData({ quiet: true }), 8000)
    return () => clearInterval(interval)
  }, [stories, childId])

  const loadData = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    const [childRes, storiesRes] = await Promise.all([
      getChildren(user.id),
      getStoriesForChild(childId)
    ])
    if (!quiet) setLoading(false)
    if (childRes.data) setChild(childRes.data.find(c => c.id === childId))
    if (storiesRes.error) { setError(storiesRes.error.message); return }
    setStories(storiesRes.data || [])
  }

  const readyCount = stories.filter(s => s.status === 'ready').length
  const inProgressCount = stories.filter(s => s.status === 'pending' || s.status === 'generating').length

  const getCoverImage = (story) => {
    const firstPage = story.pages?.find(p => p.page_number === 1)
    return firstPage?.image_url || null
  }

  const handleConfirmDelete = async () => {
    if (!storyToDelete) return
    setDeleting(true)
    setError('')
    const { error: deleteError } = await deleteStory(storyToDelete.id)
    setDeleting(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setStories(prev => prev.filter(s => s.id !== storyToDelete.id))
    setStoryToDelete(null)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', backgroundImage: `radial-gradient(ellipse at 10% 100%, rgba(45,90,61,0.06) 0%, transparent 50%)` }}>
      <AppHeader childId={childId} />

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px' }}>
        {/* Child header */}
        {child && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 36 }}>
            <div style={{ width: 56, height: 56, background: 'var(--gold-pale)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, border: '2px solid var(--border)', flexShrink: 0 }}>
              {getAvatarEmoji(child.gender, child.name)}
            </div>
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                {child.name}'s Bookshelf
              </h1>
              <p style={{ fontSize: 14, color: 'var(--ink-muted)' }}>
                {stories.length === 0
                  ? 'No stories yet'
                  : [
                      readyCount > 0 ? `${readyCount} ${readyCount === 1 ? 'story' : 'stories'}` : null,
                      inProgressCount > 0 ? `${inProgressCount} creating` : null,
                    ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Button
                id="bookshelf-new-story-btn"
                onClick={() => navigate(`/child/${childId}/prompts`)}
                style={{
                  width: 'auto',
                  padding: '10px 20px',
                  ...(showBookshelfIntro ? {
                    boxShadow: '0 0 0 3px rgba(200,136,42,0.45)',
                  } : {}),
                }}
              >
                ✨ New story
              </Button>
            </div>
          </div>
        )}

        {error && <Alert type="error">{error}</Alert>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-muted)' }}>
            <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
            Loading stories…
          </div>
        ) : stories.length === 0 ? (
          <EmptyState childName={child?.name} childId={childId} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20 }}>
            {stories.map(story => (
              <StoryCard
                key={story.id}
                story={story}
                coverImage={getCoverImage(story)}
                onDelete={() => setStoryToDelete(story)}
              />
            ))}
          </div>
        )}
      </main>

      {showBookshelfIntro && child && (
        <OnboardingModal
          title={`${child.name}'s bookshelf`}
          onDismiss={dismissBookshelfIntro}
          dismissLabel="Got it"
        >
          <p style={{ margin: 0 }}>
            This is where all of <strong>{child.name}</strong>&apos;s stories live — finished books
            and ones still being written. Tap <strong>New story</strong> (highlighted above) to
            create your first personalized adventure.
          </p>
        </OnboardingModal>
      )}

      {storyToDelete && (
        <DeleteStoryModal
          story={storyToDelete}
          loading={deleting}
          onCancel={() => !deleting && setStoryToDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function StoryCard({ story, coverImage, onDelete }) {
  const navigate = useNavigate()
  const illustrationTarget = getIllustrationTargetFromEnv() || STORY_PAGE_COUNT
  const date = new Date(story.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const inProgress = story.status === 'pending' || story.status === 'generating'
  const failed = story.status === 'error'
  const { illustratedCount } = computeIllustrationProgress(story.pages ?? [])
  const progressPct = Math.round((illustratedCount / illustrationTarget) * 100)
  const failureSummary = failed ? formatStoryFailureSummary(story, illustrationTarget) : null

  const statusLabel = failed
    ? 'Failed — tap to retry'
    : inProgress
      ? illustratedCount > 0
        ? `Painting ${illustratedCount}/${illustrationTarget}`
        : story.title
          ? 'Writing story…'
          : 'Starting…'
      : null

  const handleClick = () => {
    if (failed) {
      navigate(`/story/${story.id}/generating`)
      return
    }
    navigate(inProgress ? `/story/${story.id}/generating` : `/story/${story.id}/read`)
  }

  const handleDeleteClick = (e) => {
    e.stopPropagation()
    onDelete()
  }

  return (
    <div
      onClick={handleClick}
      style={{
        background: 'var(--warm-white)',
        border: `1px solid ${failed ? 'rgba(192,83,74,0.35)' : inProgress ? 'rgba(200,136,42,0.35)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        cursor: failed ? 'pointer' : 'pointer',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow 0.15s, transform 0.15s',
        opacity: inProgress || failed ? 0.92 : 1,
        position: 'relative',
      }}
      onMouseEnter={e => {
        if (failed) return
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
        e.currentTarget.style.transform = 'translateY(-3px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <button
        type="button"
        onClick={handleDeleteClick}
        aria-label={`Delete ${story.title || 'story'}`}
        title="Delete story"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '1px solid rgba(44,26,14,0.08)',
          background: 'rgba(255,252,245,0.92)',
          color: 'var(--ink-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          lineHeight: 1,
          boxShadow: 'var(--shadow-sm)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--rose)'
          e.currentTarget.style.borderColor = 'rgba(192,83,74,0.25)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--ink-muted)'
          e.currentTarget.style.borderColor = 'rgba(44,26,14,0.08)'
        }}
      >
        🗑
      </button>
      {/* Cover image */}
      <div style={{ height: 180, background: 'var(--gold-pale)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {coverImage ? (
          <img src={coverImage} alt={story.title} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: inProgress ? 0.7 : 1 }} />
        ) : (
          <span style={{ fontSize: 48, opacity: inProgress ? 0.6 : 1 }}>📖</span>
        )}
        {inProgress && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,252,245,0.55)',
            gap: 8,
          }}>
            <div style={{
              width: 28, height: 28,
              border: '3px solid var(--border)',
              borderTopColor: 'var(--gold)',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Creating…</span>
          </div>
        )}
      </div>
      {/* Info */}
      <div style={{ padding: '14px 14px 16px' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.3 }}>
          {story.title || (inProgress ? 'New story' : 'Untitled Story')}
        </p>
        {inProgress || failed ? (
          <>
            <p style={{
              fontSize: 12,
              color: failed ? 'var(--rose)' : 'var(--gold)',
              fontWeight: 600,
              marginBottom: failed ? 4 : 6,
            }}>
              {statusLabel}
            </p>
            {failed && failureSummary && (
              <p style={{
                fontSize: 11,
                color: 'var(--ink-muted)',
                lineHeight: 1.45,
                marginBottom: 6,
                wordBreak: 'break-word',
              }}>
                {failureSummary}
              </p>
            )}
            {inProgress && (
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: 'var(--gold)',
                  borderRadius: 99,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{date}</p>
        )}
      </div>
    </div>
  )
}

function DeleteStoryModal({ story, loading, onCancel, onConfirm }) {
  const title = story.title || 'Untitled Story'

  return (
    <div
      onClick={e => e.target === e.currentTarget && !loading && onCancel()}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(44,26,14,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        background: 'var(--warm-white)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 24px',
        width: '100%',
        maxWidth: 400,
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
      }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>
          Delete this story?
        </h2>
        <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: 24 }}>
          This will permanently remove <strong>{title}</strong> and all of its pages. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="secondary" onClick={onCancel} disabled={loading} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading} style={{ flex: 1 }}>
            Delete story
          </Button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ childName, childId }) {
  const navigate = useNavigate()
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>📚</div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>
        No stories yet!
      </h2>
      <p style={{ fontSize: 15, color: 'var(--ink-muted)', marginBottom: 28, lineHeight: 1.6 }}>
        {childName ? `Create ${childName}'s first personalised story.` : 'Create your first personalised story.'}
      </p>
      <Button onClick={() => navigate(`/child/${childId}/prompts`)} style={{ width: 'auto', margin: '0 auto', padding: '12px 28px' }}>
        ✨ Create first story
      </Button>
    </div>
  )
}
