import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getStoryWithPages } from '../lib/stories'
import AppHeader from '../components/AppHeader'

export default function StoryReader() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [story, setStory] = useState(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [imageLoaded, setImageLoaded] = useState(false)

  useEffect(() => {
    loadStory()
  }, [storyId])

  useEffect(() => {
    setImageLoaded(false)
  }, [currentPage])

  const loadStory = async () => {
    setLoading(true)
    const { data, error } = await getStoryWithPages(storyId)
    setLoading(false)
    if (error) { setError(error.message); return }
    setStory(data)
  }

  const handlePrev = () => setCurrentPage(p => Math.max(0, p - 1))
  const handleNext = () => setCurrentPage(p => Math.min((story?.pages?.length || 1) - 1, p + 1))

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'ArrowLeft') handlePrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [story, currentPage])

  if (loading) {
    return (
      <Shell title="">
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-muted)' }}>
          <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          Loading your story…
        </div>
      </Shell>
    )
  }

  if (error || !story) {
    return (
      <Shell title="">
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--rose)', marginBottom: 16 }}>Could not load the story.</p>
          <button onClick={() => navigate(-1)} style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>Go back</button>
        </div>
      </Shell>
    )
  }

  const pages = story.pages || []
  const page = pages[currentPage]
  const isFirst = currentPage === 0
  const isLast = currentPage === pages.length - 1

  return (
    <Shell title={story.title} childId={story.child_id}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Page indicator */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            Page {currentPage + 1} of {pages.length}
          </span>
        </div>

        {/* Book page */}
        <div style={{
          background: 'var(--warm-white)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)',
          animation: 'fadeIn 0.3s ease'
        }}>
          {/* Illustration */}
          <div style={{ position: 'relative', paddingTop: '66%', background: 'var(--gold-pale)', overflow: 'hidden' }}>
            {page?.image_url ? (
              <>
                {!imageLoaded && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  </div>
                )}
                <img
                  src={page.image_url}
                  alt={`Illustration for page ${currentPage + 1}`}
                  onLoad={() => setImageLoaded(true)}
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'cover',
                    opacity: imageLoaded ? 1 : 0,
                    transition: 'opacity 0.3s ease'
                  }}
                />
              </>
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56 }}>
                🎨
              </div>
            )}
          </div>

          {/* Text */}
          <div style={{ padding: '28px 32px 32px' }}>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 19,
              lineHeight: 1.75,
              color: 'var(--ink)',
              textAlign: 'center',
              fontStyle: 'italic'
            }}>
              {page?.text_content}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
          <NavButton onClick={handlePrev} disabled={isFirst} label="← Previous" />

          {/* Page dots */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center', flex: 1 }}>
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                style={{
                  width: i === currentPage ? 20 : 8,
                  height: 8,
                  borderRadius: 99,
                  background: i === currentPage ? 'var(--gold)' : 'var(--border-strong)',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'width 0.2s, background 0.2s'
                }}
                aria-label={`Go to page ${i + 1}`}
              />
            ))}
          </div>

          {isLast ? (
            <button
              onClick={() => navigate(-1)}
              style={{
                background: 'var(--gold)', color: 'white', border: 'none',
                borderRadius: 'var(--radius-sm)', padding: '10px 18px',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'var(--font-body)', whiteSpace: 'nowrap'
              }}
            >
              Finish 🎉
            </button>
          ) : (
            <NavButton onClick={handleNext} disabled={isLast} label="Next →" />
          )}
        </div>

        {/* Keyboard hint */}
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-muted)', marginTop: 16 }}>
          Use ← → arrow keys to turn pages
        </p>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </Shell>
  )
}

function NavButton({ onClick, disabled, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'var(--warm-white)',
        border: '1.5px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 18px',
        fontSize: 14,
        fontWeight: 600,
        color: disabled ? 'var(--ink-muted)' : 'var(--ink)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'var(--font-body)',
        whiteSpace: 'nowrap',
        transition: 'opacity 0.15s'
      }}
    >
      {label}
    </button>
  )
}

function Shell({ children, title, childId }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      <AppHeader title={title} childId={childId} />
      <main style={{ padding: '32px 20px 60px' }}>
        {children}
      </main>
    </div>
  )
}
