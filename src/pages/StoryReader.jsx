import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getStoryWithPages,
  illustrateNextBatch,
  isDevAdmin,
  countPlaceholderPages,
  ILLUSTRATION_BATCH_SIZE,
} from '../lib/stories'
import { useAuth } from '../contexts/AuthContext'
import AppHeader from '../components/AppHeader'

export default function StoryReader() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [story, setStory] = useState(null)
  const [currentSpread, setCurrentSpread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedImages, setLoadedImages] = useState({})
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)

  const exitFullscreen = useCallback(() => setFullscreen(false), [])
  const toggleFullscreen = useCallback(() => setFullscreen(f => !f), [])

  const loadStory = async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true)
    const { data, error: loadError } = await getStoryWithPages(storyId)
    if (showLoading) setLoading(false)
    if (loadError) {
      setError(loadError.message)
      return
    }
    setStory(data)
    if (data.status === 'ready') setBatchRunning(false)
    if (data.status === 'error') {
      setBatchRunning(false)
      setBatchError('Illustration batch failed — check edge function logs.')
    }
  }

  useEffect(() => {
    loadStory({ showLoading: true })
  }, [storyId])

  useEffect(() => {
    if (!batchRunning) return undefined
    const interval = setInterval(() => loadStory(), 5000)
    return () => clearInterval(interval)
  }, [batchRunning, storyId])

  useEffect(() => {
    setLoadedImages({})
  }, [currentSpread])

  const pages = story?.pages || []
  const pageCount = pages.length
  const placeholderCount = countPlaceholderPages(pages)
  const showDevButton = isDevAdmin(user) && placeholderCount > 0
  const illustrating = batchRunning || story?.status === 'generating'

  const handleIllustrateNext = async () => {
    setBatchError('')
    setBatchRunning(true)
    const { error: batchErr } = await illustrateNextBatch(storyId)
    if (batchErr) {
      setBatchError(batchErr.message)
      setBatchRunning(false)
    }
  }
  const spreadCount = Math.max(1, Math.ceil(pageCount / 2))
  const isFirst = currentSpread === 0
  const isLast = currentSpread >= spreadCount - 1

  const leftPage = pages[currentSpread * 2]
  const rightPage = pages[currentSpread * 2 + 1]

  const leftPageNum = currentSpread * 2 + 1
  const rightPageNum = currentSpread * 2 + 2

  const handlePrev = useCallback(() => {
    setCurrentSpread(s => Math.max(0, s - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCurrentSpread(s => Math.min(spreadCount - 1, s + 1))
  }, [spreadCount])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && fullscreen) {
        exitFullscreen()
        return
      }
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'ArrowLeft') handlePrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleNext, handlePrev, fullscreen, exitFullscreen])

  useEffect(() => {
    if (!fullscreen) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [fullscreen])

  const markImageLoaded = (pageNum) => {
    setLoadedImages(prev => ({ ...prev, [pageNum]: true }))
  }

  if (loading) {
    return (
      <ReaderShell title="">
        <div className="reader-loading">
          <div className="reader-spinner" />
          Loading your story…
        </div>
      </ReaderShell>
    )
  }

  if (error || !story) {
    return (
      <ReaderShell title="">
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--rose)', marginBottom: 16 }}>Could not load the story.</p>
          <button onClick={() => navigate(-1)} style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>Go back</button>
        </div>
      </ReaderShell>
    )
  }

  const progressLabel = rightPage && rightPageNum <= pageCount
    ? `Pages ${leftPageNum}–${rightPageNum} of ${pageCount}`
    : `Page ${leftPageNum} of ${pageCount}`

  return (
    <ReaderShell
      title={story.title}
      childId={story.child_id}
      fullscreen={fullscreen}
      onExitFullscreen={exitFullscreen}
    >
      <div className="reader-layout">
        <div className="reader-book-wrap">
          <div className="reader-book" key={currentSpread}>
            <BookPagePanel
              page={leftPage}
              pageNum={leftPageNum}
              side="left"
              loaded={!!loadedImages[leftPageNum]}
              onImageLoad={() => markImageLoaded(leftPageNum)}
            />

            <div className="reader-spine" aria-hidden="true" />

            <BookPagePanel
              page={rightPage}
              pageNum={rightPageNum}
              side="right"
              loaded={!!loadedImages[rightPageNum]}
              onImageLoad={() => markImageLoaded(rightPageNum)}
            />
          </div>
        </div>

        <div className="reader-nav">
          <NavButton onClick={handlePrev} disabled={isFirst} label="← Previous" />

          <div className="reader-progress">
            <span className="reader-progress-label">{progressLabel}</span>
            <div className="reader-progress-bar">
              <div
                className="reader-progress-fill"
                style={{ width: `${((currentSpread + 1) / spreadCount) * 100}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            className="reader-fullscreen-btn"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
          >
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>

          {isLast ? (
            <button type="button" className="reader-finish" onClick={() => navigate(-1)}>
              Finish 🎉
            </button>
          ) : (
            <NavButton onClick={handleNext} disabled={isLast} label="Next →" />
          )}
        </div>

        <p className="reader-hint">
          {fullscreen ? 'Press Esc to exit full screen · ' : ''}
          Use ← → arrow keys to turn pages
        </p>

        {showDevButton && (
          <div className="reader-dev-bar">
            <button
              type="button"
              className="reader-dev-btn"
              onClick={handleIllustrateNext}
              disabled={illustrating}
            >
              {illustrating
                ? `Generating next ${ILLUSTRATION_BATCH_SIZE} images…`
                : `Generate next ${ILLUSTRATION_BATCH_SIZE} images (${placeholderCount} placeholders left)`}
            </button>
            {batchError && <p className="reader-dev-error">{batchError}</p>}
          </div>
        )}
      </div>

      <style>{READER_STYLES}</style>
    </ReaderShell>
  )
}

function BookPagePanel({ page, pageNum, side, loaded, onImageLoad }) {
  if (!page) {
    return (
      <div className={`reader-page reader-page-${side} reader-page-empty`}>
        <div className="reader-empty-page" />
      </div>
    )
  }

  return (
    <div className={`reader-page reader-page-${side}`}>
      <div className="reader-illustration">
        {page.image_url ? (
          <>
            {!loaded && <div className="reader-spinner reader-spinner-sm" />}
            <img
              src={page.image_url}
              alt={`Illustration for page ${pageNum}`}
              onLoad={onImageLoad}
              className={`reader-image${loaded ? ' loaded' : ''}`}
            />
          </>
        ) : (
          <span className="reader-placeholder">🎨</span>
        )}
      </div>
      <div className="reader-text-wrap">
        <p className="reader-text">{page.text_content}</p>
      </div>
    </div>
  )
}

function NavButton({ onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="reader-nav-btn">
      {label}
    </button>
  )
}

function ReaderShell({ children, title, childId, fullscreen = false, onExitFullscreen }) {
  return (
    <div className={`reader-shell${fullscreen ? ' reader-shell--fullscreen' : ''}`}>
      {!fullscreen && <AppHeader title={title} childId={childId} />}
      {fullscreen && (
        <button
          type="button"
          className="reader-exit-fullscreen"
          onClick={onExitFullscreen}
          aria-label="Exit full screen"
        >
          ✕ Exit
        </button>
      )}
      <main className="reader-main">{children}</main>
    </div>
  )
}

const READER_STYLES = `
  .reader-shell {
    min-height: 100vh;
    background: var(--cream);
    background-image:
      radial-gradient(ellipse at 15% 80%, rgba(45,90,61,0.05) 0%, transparent 55%),
      radial-gradient(ellipse at 85% 20%, rgba(200,136,42,0.06) 0%, transparent 50%);
  }

  .reader-shell--fullscreen {
    position: fixed;
    inset: 0;
    z-index: 1000;
    min-height: 100vh;
    min-height: 100dvh;
  }

  .reader-shell--fullscreen .reader-main {
    min-height: 100vh;
    min-height: 100dvh;
    padding: 12px 20px 20px;
  }

  .reader-shell--fullscreen .reader-book {
    height: min(calc(100vh - 140px), calc(100dvh - 140px), 820px);
    max-height: none;
  }

  .reader-shell--fullscreen .reader-layout {
    max-width: none;
    height: 100%;
    justify-content: center;
  }

  .reader-exit-fullscreen {
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 1001;
    background: rgba(255, 252, 245, 0.95);
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
    font-family: var(--font-body);
    box-shadow: 0 4px 16px rgba(44, 26, 14, 0.12);
  }

  .reader-exit-fullscreen:hover {
    background: var(--warm-white);
  }

  .reader-fullscreen-btn {
    background: var(--warm-white);
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
    cursor: pointer;
    font-family: var(--font-body);
    white-space: nowrap;
  }

  .reader-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 64px);
    padding: 16px 20px 28px;
  }

  .reader-layout {
    width: 100%;
    max-width: 1180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    flex: 1;
  }

  .reader-book-wrap {
    width: 100%;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }

  .reader-book {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    height: min(72vh, 640px);
    min-height: 420px;
    border-radius: 6px 10px 10px 6px;
    box-shadow:
      0 28px 70px rgba(44,26,14,0.16),
      0 10px 24px rgba(44,26,14,0.08),
      inset 0 0 0 1px rgba(44,26,14,0.07);
    animation: bookOpen 0.35s ease;
    overflow: hidden;
  }

  @keyframes bookOpen {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }

  .reader-page {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .reader-page-left {
    background: linear-gradient(135deg, #f7f0e4 0%, #faf6ef 100%);
    border-radius: 4px 0 0 4px;
  }

  .reader-page-right {
    background: linear-gradient(225deg, #fffdf8 0%, #faf7f0 100%);
    border-radius: 0 4px 4px 0;
  }

  .reader-page-empty {
    background: linear-gradient(225deg, #fffdf8 0%, #faf7f0 100%);
  }

  .reader-empty-page {
    flex: 1;
    background: linear-gradient(225deg, #fffdf8 0%, #faf7f0 100%);
  }

  .reader-spine {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 18px;
    z-index: 2;
    pointer-events: none;
    background: linear-gradient(
      to right,
      rgba(44,26,14,0.14) 0%,
      rgba(44,26,14,0.06) 25%,
      rgba(255,252,245,0.5) 50%,
      rgba(44,26,14,0.06) 75%,
      rgba(44,26,14,0.14) 100%
    );
    box-shadow:
      inset 2px 0 6px rgba(44,26,14,0.08),
      inset -2px 0 6px rgba(44,26,14,0.08);
  }

  .reader-illustration {
    flex: 1 1 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 12px 6px;
    min-height: 0;
  }

  .reader-page-left .reader-illustration {
    padding-left: 18px;
    padding-right: 10px;
  }

  .reader-page-right .reader-illustration {
    padding-left: 10px;
    padding-right: 18px;
  }

  .reader-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.35s ease;
  }

  .reader-image.loaded {
    opacity: 1;
  }

  .reader-placeholder {
    font-size: 48px;
    opacity: 0.5;
  }

  .reader-text-wrap {
    flex: 0 0 auto;
    max-height: 18%;
    min-height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 14px 12px;
    border-top: 1px solid rgba(44,26,14,0.07);
    overflow: hidden;
  }

  .reader-page-left .reader-text-wrap {
    padding-left: 18px;
    padding-right: 10px;
  }

  .reader-page-right .reader-text-wrap {
    padding-left: 10px;
    padding-right: 18px;
  }

  .reader-text {
    font-family: var(--font-display);
    font-size: clamp(13px, 1.35vw, 15px);
    line-height: 1.5;
    color: var(--ink);
    margin: 0;
    text-align: center;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .reader-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    max-width: 680px;
  }

  .reader-nav-btn {
    background: var(--warm-white);
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
    font-family: var(--font-body);
    white-space: nowrap;
    transition: opacity 0.15s;
  }

  .reader-nav-btn:disabled {
    color: var(--ink-muted);
    cursor: not-allowed;
    opacity: 0.4;
  }

  .reader-progress {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .reader-progress-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .reader-progress-bar {
    width: 100%;
    max-width: 200px;
    height: 4px;
    background: var(--border);
    border-radius: 99px;
    overflow: hidden;
  }

  .reader-progress-fill {
    height: 100%;
    background: var(--gold);
    border-radius: 99px;
    transition: width 0.3s ease;
  }

  .reader-finish {
    background: var(--gold);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    font-family: var(--font-body);
    white-space: nowrap;
  }

  .reader-hint {
    font-size: 12px;
    color: var(--ink-muted);
    margin: 0;
  }

  .reader-dev-bar {
    margin-top: 20px;
    padding: 12px 16px;
    background: rgba(44, 26, 14, 0.06);
    border: 1px dashed rgba(200, 136, 42, 0.45);
    border-radius: var(--radius-sm);
    text-align: center;
  }

  .reader-dev-btn {
    background: var(--gold-pale);
    border: 1px solid rgba(200, 136, 42, 0.35);
    border-radius: var(--radius-sm);
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
    cursor: pointer;
    font-family: var(--font-body);
  }

  .reader-dev-btn:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .reader-dev-error {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--rose);
  }

  .reader-loading {
    text-align: center;
    padding: 60px;
    color: var(--ink-muted);
  }

  .reader-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--gold);
    border-radius: 50%;
    animation: readerSpin 0.7s linear infinite;
    margin: 0 auto 12px;
  }

  .reader-spinner-sm {
    width: 24px;
    height: 24px;
    position: absolute;
  }

  @keyframes readerSpin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 720px) {
    .reader-book {
      height: min(68vh, 560px);
      min-height: 360px;
    }

    .reader-illustration {
      padding: 8px 10px 4px;
    }

    .reader-text-wrap {
      max-height: 22%;
      min-height: 64px;
      padding: 6px 10px 10px;
    }

    .reader-text {
      font-size: 12px;
      line-height: 1.45;
      -webkit-line-clamp: 3;
    }

    .reader-nav {
      flex-wrap: wrap;
      justify-content: center;
    }

    .reader-fullscreen-btn {
      order: 2;
    }

    .reader-progress {
      order: -1;
      width: 100%;
    }
  }
`
