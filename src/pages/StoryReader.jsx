import { useState, useEffect, useCallback, useRef, forwardRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getStoryWithPages,
  illustrateNextBatch,
  isDevAdmin,
  countPlaceholderPages,
  ILLUSTRATION_BATCH_SIZE,
  getUserInputIntroForPage,
  splitTextAroundPhrase,
} from '../lib/stories'
import { useAuth } from '../contexts/AuthContext'
import AppHeader from '../components/AppHeader'
import {
  supportsNativeElementFullscreen,
  needsHomeScreenInstallForTrueFullscreen,
  isStandalonePWA,
} from '../lib/device'

const IPAD_INSTALL_TIP_KEY = 'little-aesop-ipad-homescreen-tip-dismissed'

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
  const [showIpadInstallTip, setShowIpadInstallTip] = useState(false)
  const [turnDirection, setTurnDirection] = useState(null)
  const [sparklePages, setSparklePages] = useState([])
  const sparkledRef = useRef(new Set())
  const touchStartRef = useRef(null)
  const turnTimerRef = useRef(null)
  const shellRef = useRef(null)
  const preloadedImagesRef = useRef(null)

  const exitNativeFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen()
      }
    } catch {
      // Browser may reject exit; CSS fallback still clears below
    }
  }, [])

  const enterNativeFullscreen = useCallback(async (element) => {
    if (!element) return false
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen()
        return true
      }
      if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen()
        return true
      }
    } catch {
      return false
    }
    return false
  }, [])

  const exitFullscreen = useCallback(async () => {
    await exitNativeFullscreen()
    setFullscreen(false)
  }, [exitNativeFullscreen])

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      await exitFullscreen()
      setShowIpadInstallTip(false)
      return
    }
    setFullscreen(true)
    if (supportsNativeElementFullscreen()) {
      requestAnimationFrame(async () => {
        await enterNativeFullscreen(shellRef.current)
      })
    } else if (
      needsHomeScreenInstallForTrueFullscreen()
      && !sessionStorage.getItem(IPAD_INSTALL_TIP_KEY)
    ) {
      setShowIpadInstallTip(true)
    }
  }, [fullscreen, exitFullscreen, enterNativeFullscreen])

  const dismissIpadInstallTip = useCallback(() => {
    sessionStorage.setItem(IPAD_INSTALL_TIP_KEY, '1')
    setShowIpadInstallTip(false)
  }, [])

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
    sparkledRef.current = new Set()
    setSparklePages([])
  }, [storyId])

  const pages = story?.pages || []

  useEffect(() => {
    if (!story?.id || !pages.length) return
    if (preloadedImagesRef.current === story.id) return
    preloadedImagesRef.current = story.id

    pages.forEach((p) => {
      if (!p.image_url) return
      const img = new Image()
      const mark = () => {
        setLoadedImages((prev) => (prev[p.page_number] ? prev : { ...prev, [p.page_number]: true }))
      }
      img.onload = mark
      img.src = p.image_url
      if (img.complete && img.naturalWidth > 0) mark()
    })
  }, [story?.id, pages])
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

  useEffect(() => {
    if (!story?.story_metadata) return undefined

    const pagesOnSpread = [leftPageNum, rightPageNum].filter(
      (p) => p <= pageCount && getUserInputIntroForPage(story.story_metadata, p),
    )
    const fresh = pagesOnSpread.filter((p) => !sparkledRef.current.has(p))
    if (fresh.length === 0) return undefined

    fresh.forEach((p) => sparkledRef.current.add(p))
    setSparklePages(fresh)

    const timer = setTimeout(() => setSparklePages([]), 2400)
    return () => clearTimeout(timer)
  }, [currentSpread, story?.story_metadata, leftPageNum, rightPageNum, pageCount])

  const handlePrev = useCallback(() => {
    setTurnDirection('back')
    setCurrentSpread(s => Math.max(0, s - 1))
  }, [])

  const handleNext = useCallback(() => {
    setTurnDirection('forward')
    setCurrentSpread(s => Math.min(spreadCount - 1, s + 1))
  }, [spreadCount])

  useEffect(() => {
    if (!turnDirection) return undefined
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current)
    turnTimerRef.current = setTimeout(() => setTurnDirection(null), 380)
    return () => {
      if (turnTimerRef.current) clearTimeout(turnTimerRef.current)
    }
  }, [currentSpread, turnDirection])

  const handleTouchStart = useCallback((e) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }, [])

  const handleTouchEnd = useCallback((e) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return

    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    const minSwipe = 48

    if (Math.abs(dx) < minSwipe || Math.abs(dx) < Math.abs(dy) * 1.2) return

    if (dx < 0 && !isLast) handleNext()
    else if (dx > 0 && !isFirst) handlePrev()
  }, [handleNext, handlePrev, isFirst, isLast])

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
    const syncFullscreen = () => {
      const active = !!(document.fullscreenElement || document.webkitFullscreenElement)
      if (!active) setFullscreen(false)
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('webkitfullscreenchange', syncFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('webkitfullscreenchange', syncFullscreen)
    }
  }, [])

  useEffect(() => {
    if (!fullscreen) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [fullscreen])

  const markImageLoaded = useCallback((pageNum) => {
    setLoadedImages((prev) => (prev[pageNum] ? prev : { ...prev, [pageNum]: true }))
  }, [])

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

  const fullscreenBtnLabel = fullscreen
    ? 'Exit full screen'
    : needsHomeScreenInstallForTrueFullscreen()
      ? 'Immersive mode'
      : 'Full screen'

  return (
    <ReaderShell
      ref={shellRef}
      title={story.title}
      childId={story.child_id}
      fullscreen={fullscreen}
      onExitFullscreen={exitFullscreen}
    >
      {showIpadInstallTip && fullscreen && (
        <div className="reader-ipad-install-tip" role="dialog" aria-labelledby="ipad-install-title">
          <p id="ipad-install-title" className="reader-ipad-install-tip__title">
            Want movie-style full screen?
          </p>
          <p className="reader-ipad-install-tip__body">
            iPad browsers can&apos;t hide tabs from a website. For a truly full-screen story
            (no address bar or tabs), add Little Aesop to your home screen:
          </p>
          <ol className="reader-ipad-install-tip__steps">
            <li>Tap the <strong>Share</strong> button in Safari or Chrome</li>
            <li>Choose <strong>Add to Home Screen</strong></li>
            <li>Open <strong>Little Aesop</strong> from your home screen</li>
          </ol>
          <div className="reader-ipad-install-tip__actions">
            <button type="button" className="reader-ipad-install-tip__btn" onClick={dismissIpadInstallTip}>
              Continue in immersive mode
            </button>
          </div>
        </div>
      )}
      <div className={`reader-layout${fullscreen ? ' reader-layout--fullscreen' : ''}`}>
        <div
          className="reader-book-wrap"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className={`reader-book${turnDirection ? ` reader-book--turn-${turnDirection}` : ''}`}
          >
            <BookPagePanel
              page={leftPage}
              pageNum={leftPageNum}
              side="left"
              loaded={!!loadedImages[leftPageNum]}
              onImageLoad={() => markImageLoaded(leftPageNum)}
              highlightPhrase={getUserInputIntroForPage(story.story_metadata, leftPageNum)}
              sparkleActive={sparklePages.includes(leftPageNum)}
            />

            <div className="reader-spine" aria-hidden="true" />

            <BookPagePanel
              page={rightPage}
              pageNum={rightPageNum}
              side="right"
              loaded={!!loadedImages[rightPageNum]}
              onImageLoad={() => markImageLoaded(rightPageNum)}
              highlightPhrase={getUserInputIntroForPage(story.story_metadata, rightPageNum)}
              sparkleActive={sparklePages.includes(rightPageNum)}
            />
          </div>
        </div>

        <div className={`reader-nav${fullscreen ? ' reader-nav--overlay' : ''}`}>
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
            {fullscreen ? 'Exit full screen' : fullscreenBtnLabel}
          </button>

          {isLast ? (
            <button type="button" className="reader-finish" onClick={() => navigate(-1)}>
              Finish 🎉
            </button>
          ) : (
            <NavButton onClick={handleNext} disabled={isLast} label="Next →" />
          )}
        </div>

        {!fullscreen && (
          <p className="reader-hint">
            Use ← → arrow keys or swipe to turn pages
          </p>
        )}

        {fullscreen && (
          <p className="reader-hint reader-hint--fullscreen">
            Swipe left or right to turn pages
            {needsHomeScreenInstallForTrueFullscreen() && ' · Add to Home Screen for no browser bars'}
          </p>
        )}

        {showDevButton && !fullscreen && (
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

function BookPagePanel({ page, pageNum, side, loaded, onImageLoad, highlightPhrase, sparkleActive }) {
  const imgRef = useRef(null)

  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      onImageLoad()
    }
  }, [page?.image_url, onImageLoad])

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
            {!loaded && <div className="reader-spinner reader-spinner-sm" aria-hidden="true" />}
            <img
              ref={imgRef}
              src={page.image_url}
              alt={`Illustration for page ${pageNum}`}
              onLoad={onImageLoad}
              decoding="async"
              className={`reader-image${loaded ? ' loaded' : ''}`}
            />
          </>
        ) : (
          <span className="reader-placeholder">🎨</span>
        )}
      </div>
      <div className="reader-text-wrap">
        <StoryPageText
          text={page.text_content}
          highlightPhrase={highlightPhrase}
          sparkleActive={sparkleActive}
        />
      </div>
    </div>
  )
}

function StoryPageText({ text, highlightPhrase, sparkleActive }) {
  const segments = splitTextAroundPhrase(text, highlightPhrase)

  return (
    <p className="reader-text">
      {segments.map((seg, i) =>
        seg.type === 'highlight' ? (
          <span
            key={i}
            className={`reader-input-highlight${sparkleActive ? ' reader-input-highlight--active' : ''}`}
          >
            {sparkleActive && <span className="reader-sparkle" aria-hidden="true">✦</span>}
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </p>
  )
}

function NavButton({ onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="reader-nav-btn">
      {label}
    </button>
  )
}

const ReaderShell = forwardRef(function ReaderShell(
  { children, title, childId, fullscreen = false, onExitFullscreen },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`reader-shell${fullscreen ? ' reader-shell--fullscreen' : ''}`}
    >
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
})

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
    width: 100%;
    height: 100%;
    min-height: 100vh;
    min-height: -webkit-fill-available;
    min-height: 100dvh;
    background: #1a1208;
    background-image:
      radial-gradient(ellipse at 50% 30%, rgba(200,136,42,0.08) 0%, transparent 55%);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }

  .reader-ipad-install-tip {
    position: fixed;
    top: max(12px, env(safe-area-inset-top));
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    z-index: 1003;
    background: rgba(255, 252, 245, 0.97);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 16px 18px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    text-align: left;
  }

  .reader-ipad-install-tip__title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 8px;
  }

  .reader-ipad-install-tip__body {
    font-size: 14px;
    color: var(--ink-soft);
    line-height: 1.5;
    margin: 0 0 10px;
  }

  .reader-ipad-install-tip__steps {
    margin: 0 0 14px;
    padding-left: 20px;
    font-size: 14px;
    color: var(--ink);
    line-height: 1.55;
  }

  .reader-ipad-install-tip__actions {
    display: flex;
    justify-content: flex-end;
  }

  .reader-ipad-install-tip__btn {
    background: var(--ink);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--font-body);
  }

  /* Native Fullscreen API — hides browser tabs/chrome when supported */
  .reader-shell:fullscreen,
  .reader-shell:-webkit-full-screen {
    width: 100%;
    height: 100%;
    max-height: none;
    border: none;
    margin: 0;
    background: #1a1208;
    background-image:
      radial-gradient(ellipse at 50% 30%, rgba(200,136,42,0.08) 0%, transparent 55%);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }

  .reader-shell:fullscreen .reader-main,
  .reader-shell:-webkit-full-screen .reader-main {
    min-height: 100%;
    height: 100%;
    padding: 0;
  }

  .reader-shell--fullscreen .reader-main {
    min-height: 100%;
    height: 100%;
    padding: 0;
    justify-content: stretch;
  }

  .reader-layout--fullscreen {
    max-width: none;
    width: 100%;
    height: 100%;
    gap: 0;
    justify-content: center;
    padding: 0;
  }

  .reader-shell--fullscreen .reader-book-wrap {
    flex: 1;
    width: 100%;
    padding: 8px 6px 88px;
    touch-action: pan-y pinch-zoom;
  }

  .reader-shell--fullscreen .reader-book {
    width: 100%;
    height: 100%;
    max-height: none;
    min-height: 0;
    border-radius: 4px 8px 8px 4px;
    box-shadow:
      0 40px 100px rgba(0,0,0,0.45),
      0 12px 32px rgba(0,0,0,0.25),
      inset 0 0 0 1px rgba(255,252,245,0.06);
  }

  .reader-nav--overlay {
    position: fixed;
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
    z-index: 1002;
    max-width: none;
    padding: 10px 14px;
    background: rgba(255, 252, 245, 0.94);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(8px);
  }

  .reader-hint--fullscreen {
    position: fixed;
    bottom: max(72px, calc(env(safe-area-inset-bottom) + 62px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 1001;
    color: rgba(255, 252, 245, 0.55);
    font-size: 11px;
    pointer-events: none;
    white-space: nowrap;
  }

  .reader-book--turn-forward {
    animation: pageTurnForward 0.38s ease-out;
  }

  .reader-book--turn-back {
    animation: pageTurnBack 0.38s ease-out;
  }

  @keyframes pageTurnForward {
    from {
      transform: perspective(1200px) rotateY(-4deg) translateX(12px);
    }
    to {
      transform: perspective(1200px) rotateY(0deg) translateX(0);
    }
  }

  @keyframes pageTurnBack {
    from {
      transform: perspective(1200px) rotateY(4deg) translateX(-12px);
    }
    to {
      transform: perspective(1200px) rotateY(0deg) translateX(0);
    }
  }

  .reader-shell--fullscreen .reader-exit-fullscreen {
    top: max(10px, env(safe-area-inset-top));
    right: max(10px, env(safe-area-inset-right));
    background: rgba(255, 252, 245, 0.92);
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
    -webkit-tap-highlight-color: transparent;
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
    overflow: hidden;
  }

  .reader-book--open {
    animation: bookOpen 0.35s ease;
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
    opacity: 1;
  }

  .reader-image:not(.loaded) {
    opacity: 0;
    transition: opacity 0.2s ease;
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

  .reader-input-highlight {
    position: relative;
    display: inline;
    border-radius: 3px;
  }

  .reader-input-highlight--active {
    animation: readerInputSparkle 2.4s ease forwards;
  }

  @keyframes readerInputSparkle {
    0% {
      background: rgba(200, 136, 42, 0.5);
      box-shadow: 0 0 10px rgba(200, 136, 42, 0.45);
    }
    25% {
      background: rgba(200, 136, 42, 0.35);
    }
    100% {
      background: transparent;
      box-shadow: none;
    }
  }

  .reader-sparkle {
    position: absolute;
    top: -0.55em;
    right: -0.35em;
    font-size: 0.85em;
    color: var(--gold);
    line-height: 1;
    pointer-events: none;
    animation: readerSparklePop 2.4s ease forwards;
  }

  @keyframes readerSparklePop {
    0% {
      opacity: 0;
      transform: scale(0.4) rotate(-20deg);
    }
    12% {
      opacity: 1;
      transform: scale(1.3) rotate(10deg);
    }
    35% {
      opacity: 1;
      transform: scale(1) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: scale(0.5) rotate(30deg);
    }
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

    .reader-shell--fullscreen .reader-book {
      height: 100%;
      min-height: 0;
    }

    .reader-shell--fullscreen .reader-book-wrap {
      padding-bottom: 72px;
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
