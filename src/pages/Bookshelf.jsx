import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getStoriesForChild, STORY_PAGE_COUNT } from '../lib/stories'
import { getChildren, getAvatarEmoji } from '../lib/children'
import { Button, Alert } from '../components/ui'
import AppHeader from '../components/AppHeader'

export default function Bookshelf() {
  const { childId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stories, setStories] = useState([])
  const [child, setChild] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
                onClick={() => navigate(`/child/${childId}/prompts`)}
                style={{ width: 'auto', padding: '10px 20px' }}
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
              <StoryCard key={story.id} story={story} coverImage={getCoverImage(story)} />
            ))}
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function StoryCard({ story, coverImage }) {
  const navigate = useNavigate()
  const date = new Date(story.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const inProgress = story.status === 'pending' || story.status === 'generating'
  const pagesCompleted = Math.max(story.pages_completed ?? 0, story.pages?.length ?? 0)
  const progressPct = Math.round((pagesCompleted / STORY_PAGE_COUNT) * 100)

  const statusLabel = inProgress
    ? pagesCompleted > 0
      ? `Painting ${pagesCompleted}/${STORY_PAGE_COUNT}`
      : story.title
        ? 'Writing story…'
        : 'Starting…'
    : null

  const handleClick = () => {
    navigate(inProgress ? `/story/${story.id}/generating` : `/story/${story.id}/read`)
  }

  return (
    <div
      onClick={handleClick}
      style={{
        background: 'var(--warm-white)',
        border: `1px solid ${inProgress ? 'rgba(200,136,42,0.35)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow 0.15s, transform 0.15s',
        opacity: inProgress ? 0.92 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)' }}
    >
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
        {inProgress ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 600, marginBottom: 6 }}>{statusLabel}</p>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'var(--gold)',
                borderRadius: 99,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{date}</p>
        )}
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
