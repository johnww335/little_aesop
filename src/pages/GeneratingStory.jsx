import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getStoryProgress,
  getStoryWithPages,
  STORY_PAGE_COUNT,
  getIllustrationTargetFromEnv,
  getStoredDeployInfo,
  fetchEdgeFunctionVersion,
  getDeployWarningMessage,
  storeDeployInfo,
  inferGenerationErrorHint,
  createGenerationProgressTracker,
  touchGenerationProgressTracker,
  evaluateGenerationHealth,
  getStallDiagnostics,
  resumeStoryIllustration,
  EXPECTED_FUNCTION_VERSION,
  MAX_POLL_FAILURES,
  GENERATION_STALL_LIMITS,
} from '../lib/stories'
import {
  log,
  warn,
  error as logError,
  logStoryText,
  logStoryMetadata,
  logStoryFailure,
  logGenerationProgress,
  looksLikeTemplateStory,
  logImageDiagnostics,
} from '../lib/logger'
import AppHeader from '../components/AppHeader'

const POLL_INTERVAL = 5000
const GENERATING_HEARTBEAT_POLLS = 12 // log every ~60s while status unchanged

const MESSAGES = [
  "Writing your story…",
  "Choosing the perfect words…",
  "Drawing the illustrations…",
  "Painting page 1…",
  "Painting page 5…",
  "Painting page 10…",
  "Painting page 15…",
  "Almost done…",
  "Adding the finishing touches…",
  "Your story is nearly ready!",
]

function stopGenerationWatch(pollRef, messageRef) {
  clearInterval(pollRef.current)
  clearInterval(messageRef.current)
}

export default function GeneratingStory() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const illustrationTarget = getIllustrationTargetFromEnv() || STORY_PAGE_COUNT
  const [messageIndex, setMessageIndex] = useState(0)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [errorHint, setErrorHint] = useState('')
  const [pagesCompleted, setPagesCompleted] = useState(0)
  const [pagesInDb, setPagesInDb] = useState(0)
  const [storyTitle, setStoryTitle] = useState('')
  const [childId, setChildId] = useState(null)
  const [phase, setPhase] = useState('starting') // starting | writing | preparing | illustrating | ready
  const [elapsedMin, setElapsedMin] = useState(0)
  const [deployWarning, setDeployWarning] = useState(null)
  const [stallWarning, setStallWarning] = useState(null)
  const [generationWatchKey, setGenerationWatchKey] = useState(0)
  const [resumeLoading, setResumeLoading] = useState(false)
  const pollRef = useRef(null)
  const messageRef = useRef(null)
  const pollCountRef = useRef(0)
  const pollFailuresRef = useRef(0)
  const progressTrackerRef = useRef(createGenerationProgressTracker())
  const metadataLoggedRef = useRef(false)
  const autoResumeRef = useRef({ illustratedCount: -1, attempts: 0, inFlight: false })

  const tryAutoResumeIllustrations = async (illustratedCount, reason) => {
    if (autoResumeRef.current.inFlight) return false
    if (illustratedCount <= 0 || illustratedCount >= illustrationTarget) return false

    if (autoResumeRef.current.illustratedCount !== illustratedCount) {
      autoResumeRef.current = { illustratedCount, attempts: 0, inFlight: false }
    }
    if (autoResumeRef.current.attempts >= 5) return false

    autoResumeRef.current.inFlight = true
    autoResumeRef.current.attempts += 1
    log('GeneratingStory', 'Auto-resuming stalled illustrations', {
      storyId,
      illustratedCount,
      attempt: autoResumeRef.current.attempts,
      reason,
    })

    const { error: resumeError } = await resumeStoryIllustration(storyId)
    autoResumeRef.current.inFlight = false

    if (resumeError) {
      logError('GeneratingStory', 'Auto-resume failed', { storyId, message: resumeError.message })
      return false
    }

    progressTrackerRef.current = createGenerationProgressTracker()
    setStallWarning(`Restarting from page ${illustratedCount + 1}… (attempt ${autoResumeRef.current.attempts})`)
    return true
  }

  const failGeneration = (message, hint, diagnostics) => {
    logStoryFailure(storyId, { message, hint, ...diagnostics })
    logError('GeneratingStory', 'Stopping — generation not progressing', diagnostics ?? { storyId, message, hint })
    stopGenerationWatch(pollRef, messageRef)
    setErrorMessage(message)
    setErrorHint(hint)
    setError(true)
  }

  useEffect(() => {
    pollCountRef.current = 0
    pollFailuresRef.current = 0
    metadataLoggedRef.current = false
    autoResumeRef.current = { illustratedCount: -1, attempts: 0, inFlight: false }
    progressTrackerRef.current = createGenerationProgressTracker()
    setStallWarning(null)
    log('GeneratingStory', 'Watching story generation', { storyId, pollIntervalMs: POLL_INTERVAL })

    fetchEdgeFunctionVersion().then(({ data }) => {
      if (data) {
        storeDeployInfo(storyId, data)
        setDeployWarning(getDeployWarningMessage(data))
      } else {
        setDeployWarning(getDeployWarningMessage(getStoredDeployInfo(storyId)))
      }
    })

    messageRef.current = setInterval(() => {
      setMessageIndex(prev => Math.min(prev + 1, MESSAGES.length - 1))
    }, 18000)

    const checkStatus = async () => {
      const { data, error: pollError } = await getStoryProgress(storyId)

      if (pollError || !data) {
        pollFailuresRef.current += 1
        logError('GeneratingStory', 'Poll failed', {
          storyId,
          attempt: pollFailuresRef.current,
          message: pollError?.message ?? 'No data returned',
        })
        if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
          failGeneration(
            'Could not reach the server.',
            'Check your internet connection and that your Supabase project is active. If this keeps happening, try again in a few minutes.',
            { storyId, pollFailures: pollFailuresRef.current },
          )
        }
        return
      }

      pollFailuresRef.current = 0
      pollCountRef.current += 1

      const snapshot = {
        status: data.status,
        title: data.title,
        pagesCompletedCol: data.pagesCompletedCol,
        pagesInDb: data.pagesInDb,
        illustratedCount: data.illustratedCount,
      }

      const timing = touchGenerationProgressTracker(progressTrackerRef.current, snapshot)
      const health = evaluateGenerationHealth(snapshot, timing, illustrationTarget)

      if (timing.changed) {
        logGenerationProgress(storyId, snapshot, timing, health)
      } else if (pollCountRef.current % GENERATING_HEARTBEAT_POLLS === 0) {
        logGenerationProgress(storyId, snapshot, timing, health)
      }

      setPagesCompleted(data.illustratedCount)
      setPagesInDb(data.pagesInDb)
      setElapsedMin(Math.floor(timing.elapsedMs / 60000))
      if (data.title) setStoryTitle(data.title)
      if (data.childId) setChildId(data.childId)

      if (data.storyMetadata && !metadataLoggedRef.current) {
        metadataLoggedRef.current = true
        logStoryMetadata(storyId, data.storyMetadata)
      }

      if (data.status === 'pending') {
        setPhase('starting')
      } else if (data.status === 'generating') {
        if (data.illustratedCount > 0) {
          setPhase('illustrating')
        } else if (data.pagesInDb > 0) {
          setPhase('preparing')
        } else if (data.title) {
          setPhase('preparing')
        } else {
          setPhase('writing')
        }
      }

      if (!health.healthy) {
        if (
          health.code === 'illustrating_stalled'
          && data.status === 'generating'
          && data.illustratedCount > 0
        ) {
          const resumed = await tryAutoResumeIllustrations(data.illustratedCount, health.code)
          if (resumed) return
        }

        const diagnostics = getStallDiagnostics(storyId, snapshot, timing, health)
        const deployInfo = getStoredDeployInfo(storyId)
        const hint = inferGenerationErrorHint({
          errorMessage: health.message,
          pagesCompleted: data.illustratedCount,
          storyTitle: data.title,
          deployInfo,
        })
        failGeneration(health.message, hint, diagnostics)
        return
      }

      // Soft warning before hard stall (at ~75% of the relevant limit)
      if (data.status === 'pending' && timing.staleMs > GENERATION_STALL_LIMITS.pending * 0.75) {
        setStallWarning('Still waiting for the server to start…')
      } else if (data.status === 'generating' && timing.staleMs > GENERATION_STALL_LIMITS.illustrating * 0.5 && data.illustratedCount === 0 && data.pagesInDb > 0) {
        setStallWarning('Illustrations are taking longer than usual — still working…')
      } else if (data.status === 'generating' && timing.staleMs > GENERATION_STALL_LIMITS.illustrating * 0.75 && data.illustratedCount > 0) {
        setStallWarning(`Still painting (page ${data.illustratedCount} of ${illustrationTarget})…`)
        if (timing.staleMs >= GENERATION_STALL_LIMITS.autoResumeIllustrating) {
          await tryAutoResumeIllustrations(data.illustratedCount, 'proactive_stale')
        }
      } else {
        setStallWarning(null)
      }

      if (data?.status === 'ready') {
        setPhase('ready')
        setPagesCompleted(data.totalPages)
        log('GeneratingStory', 'Story ready — redirecting to reader', {
          storyId,
          title: data.title,
          illustratedCount: data.illustratedCount,
          elapsedMin: Math.floor(timing.elapsedMs / 60000),
        })
        const { data: fullStory } = await getStoryWithPages(storyId)
        if (fullStory?.pages?.length) {
          logImageDiagnostics(storyId, fullStory.pages)
          const textPages = fullStory.pages.map(p => p.text_content)
          if (looksLikeTemplateStory(textPages)) {
            warn('GeneratingStory', '⚠️  Placeholder template story text — set OPENAI_API_KEY in Supabase and redeploy generate-story', { storyId, title: fullStory.title })
          }
          if (import.meta.env.VITE_DEV_STORY_MODE === 'true') {
            logStoryText(storyId, { title: fullStory.title, pages: textPages })
          }
        }
        stopGenerationWatch(pollRef, messageRef)
        navigate(`/story/${storyId}/read`, { replace: true })
      } else if (data?.status === 'error') {
        logStoryFailure(storyId, {
          source: 'server',
          errorMessage: data.errorMessage,
          illustratedCount: data.illustratedCount,
        })
        logError('GeneratingStory', 'Story generation failed on server', {
          storyId,
          errorMessage: data.errorMessage,
          illustratedCount: data.illustratedCount,
          diagnostics: getStallDiagnostics(storyId, snapshot, timing, { code: 'server_error', message: data.errorMessage }),
        })
        const deployInfo = getStoredDeployInfo(storyId)
        const hint = inferGenerationErrorHint({
          errorMessage: data.errorMessage,
          pagesCompleted: data.illustratedCount,
          storyTitle: data.title,
          deployInfo,
        })
        failGeneration(data.errorMessage || 'Story generation failed.', hint, { storyId, serverError: data.errorMessage, illustratedCount: data.illustratedCount })
      }
    }

    checkStatus()
    pollRef.current = setInterval(checkStatus, POLL_INTERVAL)

    return () => {
      stopGenerationWatch(pollRef, messageRef)
    }
  }, [storyId, navigate, illustrationTarget, generationWatchKey])

  const canResumeIllustrations = pagesCompleted > 0 && pagesCompleted < illustrationTarget

  const handleResumeIllustrations = async () => {
    setResumeLoading(true)
    const { error: resumeError } = await resumeStoryIllustration(storyId)
    setResumeLoading(false)
    if (resumeError) {
      setErrorHint(resumeError.message)
      return
    }
    setError(false)
    setErrorMessage('')
    setErrorHint('')
    setStallWarning(null)
    setGenerationWatchKey((k) => k + 1)
  }

  const progressTarget = phase === 'illustrating' ? illustrationTarget : STORY_PAGE_COUNT
  const progressValue = phase === 'illustrating' ? pagesCompleted : pagesInDb > 0 ? pagesInDb : (storyTitle ? 1 : 0)

  if (error) {
    return (
      <Shell childId={childId}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>😔</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', marginBottom: 12, lineHeight: 1.6 }}>
            We had trouble creating your story. Please try again.
          </p>
          {(errorHint || errorMessage) && (
            <div style={{
              background: 'var(--cream)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              marginBottom: 16,
              textAlign: 'left',
            }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>What went wrong</p>
              <p style={{ fontSize: 13, color: 'var(--rose)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                {errorHint || errorMessage}
              </p>
            </div>
          )}
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 28, lineHeight: 1.6 }}>
            Check the browser console for detailed progress logs (search for <strong>GeneratingStory</strong>).
            In Supabase: Edge Functions → generate-story → Logs.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            {canResumeIllustrations && (
              <button
                onClick={handleResumeIllustrations}
                disabled={resumeLoading}
                style={{ background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px 28px', fontSize: 15, fontWeight: 700, cursor: resumeLoading ? 'wait' : 'pointer', fontFamily: 'var(--font-body)', opacity: resumeLoading ? 0.7 : 1 }}
              >
                {resumeLoading ? 'Resuming…' : `Resume illustrations (${pagesCompleted}/${illustrationTarget})`}
              </button>
            )}
            <button
              onClick={() => navigate(childId ? `/child/${childId}/prompts` : -2)}
              style={{ background: canResumeIllustrations ? 'transparent' : 'var(--gold)', color: canResumeIllustrations ? 'var(--ink-soft)' : 'white', border: canResumeIllustrations ? '1px solid var(--border)' : 'none', borderRadius: 'var(--radius-sm)', padding: '12px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
            >
              Try again
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell childId={childId}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 32, position: 'relative', display: 'inline-block' }}>
          <div style={{ fontSize: 72, animation: 'float 3s ease-in-out infinite' }}>📖</div>
          <div style={{
            position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
            width: 60, height: 8, background: 'rgba(44,26,14,0.08)',
            borderRadius: '50%', animation: 'shadow 3s ease-in-out infinite'
          }} />
        </div>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>
          {storyTitle ? storyTitle : 'Creating your story…'}
        </h2>
        <p style={{ fontSize: 16, color: 'var(--ink-soft)', marginBottom: 8, minHeight: 28, transition: 'opacity 0.5s', fontStyle: 'italic' }}>
          {phase === 'illustrating'
            ? `Painting illustration ${pagesCompleted} of ${illustrationTarget}…`
            : phase === 'preparing'
              ? 'Starting illustrations…'
              : phase === 'writing'
                ? 'Writing your story…'
                : MESSAGES[messageIndex]}
        </p>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
              {phase === 'illustrating' ? 'Illustrations' : 'Progress'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)' }}>
              {phase === 'illustrating'
                ? `${pagesCompleted} / ${illustrationTarget}`
                : `${progressValue} / ${progressTarget}`}
            </span>
          </div>
          <div style={{
            height: 10,
            background: 'var(--border)',
            borderRadius: 99,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, Math.round((progressValue / progressTarget) * 100))}%`,
              background: 'linear-gradient(90deg, var(--gold), #e8a830)',
              borderRadius: 99,
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>
          Illustrating all {illustrationTarget} pages (~20–40 min). You can leave and come back!
        </p>

        {deployWarning && (
          <div style={{
            marginBottom: 16,
            background: 'var(--gold-pale)',
            border: '1px solid rgba(200,136,42,0.25)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>⚠️ {deployWarning}</p>
          </div>
        )}

        {stallWarning && (
          <div style={{
            marginBottom: 16,
            background: 'var(--gold-pale)',
            border: '1px solid rgba(200,136,42,0.25)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: canResumeIllustrations ? 10 : 0 }}>⏳ {stallWarning}</p>
            {canResumeIllustrations && (
              <button
                type="button"
                onClick={handleResumeIllustrations}
                disabled={resumeLoading}
                style={{ background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: resumeLoading ? 'wait' : 'pointer', fontFamily: 'var(--font-body)' }}
              >
                {resumeLoading ? 'Resuming…' : 'Resume illustrations'}
              </button>
            )}
          </div>
        )}

        {elapsedMin >= 8 && pagesCompleted === 0 && pagesInDb === 0 && (
          <div style={{
            marginBottom: 24,
            background: 'var(--rose-pale)',
            border: '1px solid rgba(192,83,74,0.2)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 13, color: 'var(--rose)', lineHeight: 1.6, marginBottom: 8 }}>
              <strong>Taking longer than expected.</strong> No progress after {elapsedMin} minutes.
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              Open the browser console and filter for <strong>GeneratingStory</strong> to see progress snapshots.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 10, height: 10,
              background: 'var(--gold)',
              borderRadius: '50%',
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`
            }} />
          ))}
        </div>

        <div style={{
          marginTop: 48,
          background: 'var(--gold-pale)',
          border: '1px solid rgba(200,136,42,0.2)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          textAlign: 'left'
        }}>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            💡 <strong>Tip:</strong> Your story opens automatically when all {illustrationTarget} illustrations are ready. If loading stops with an error, check the console — we log exactly where progress stalled.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes shadow {
          0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.5; }
          50% { transform: translateX(-50%) scaleX(0.7); opacity: 0.2; }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </Shell>
  )
}

function Shell({ children, childId }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', flexDirection: 'column' }}>
      <AppHeader childId={childId} />
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          {children}
        </div>
      </main>
    </div>
  )
}
