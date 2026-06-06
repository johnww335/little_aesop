import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getStoryProgress,
  getStoryWithPages,
  STORY_PAGE_COUNT,
  getStoredDeployInfo,
  inferGenerationErrorHint,
} from '../lib/stories'
import { log, warn, error as logError, logStoryText, looksLikeTemplateStory, logImageDiagnostics } from '../lib/logger'
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

export default function GeneratingStory() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [messageIndex, setMessageIndex] = useState(0)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [errorHint, setErrorHint] = useState('')
  const [pagesCompleted, setPagesCompleted] = useState(0)
  const [storyTitle, setStoryTitle] = useState('')
  const [childId, setChildId] = useState(null)
  const [phase, setPhase] = useState('starting') // starting | writing | preparing | illustrating | ready
  const [elapsedMin, setElapsedMin] = useState(0)
  const [deployWarning, setDeployWarning] = useState(null)
  const pollRef = useRef(null)
  const messageRef = useRef(null)
  const lastStatusRef = useRef(null)
  const pollCountRef = useRef(0)
  const startedRef = useRef(Date.now())

  useEffect(() => {
    lastStatusRef.current = null
    pollCountRef.current = 0
    startedRef.current = Date.now()
    log('GeneratingStory', 'Watching story generation', { storyId })

    const deployInfo = getStoredDeployInfo(storyId)
    if (deployInfo && deployInfo.functionVersion !== '2025-06-15') {
      setDeployWarning(`Deployed edge function is ${deployInfo.functionVersion ?? 'outdated'} — deploy generate-story (2025-06-15) for GPT Image support.`)
    }
    if (deployInfo?.hasOpenAiKey === false) {
      setDeployWarning('OPENAI_API_KEY is not set on the edge function.')
    }

    // Cycle through friendly messages
    messageRef.current = setInterval(() => {
      setMessageIndex(prev => Math.min(prev + 1, MESSAGES.length - 1))
    }, 18000)

    // Poll story status every 5 seconds (check immediately on mount too)
    const checkStatus = async () => {
      const { data, error } = await getStoryProgress(storyId)
      if (error || !data) return

      setPagesCompleted(data.pagesCompleted)
      setElapsedMin(Math.floor((Date.now() - startedRef.current) / 60000))
      if (data.title) setStoryTitle(data.title)
      if (data.childId) setChildId(data.childId)

      if (data.status === 'pending') {
        setPhase('starting')
      } else if (data.status === 'generating') {
        if (data.pagesCompleted > 0) {
          setPhase('illustrating')
        } else if (data.title) {
          setPhase('preparing')
        } else {
          setPhase('writing')
        }
      }

      if (data?.status === 'ready') {
        setPhase('ready')
        setPagesCompleted(data.totalPages)
        log('GeneratingStory', 'Story ready — redirecting to reader', { storyId, title: data.title })
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
        clearInterval(pollRef.current)
        clearInterval(messageRef.current)
        navigate(`/story/${storyId}/read`, { replace: true })
      } else if (data?.status === 'error') {
        logError('GeneratingStory', 'Story generation failed on server', {
          storyId,
          errorMessage: data.errorMessage,
          pagesCompleted: data.pagesCompleted,
        })
        const deployInfo = getStoredDeployInfo(storyId)
        const hint = inferGenerationErrorHint({
          errorMessage: data.errorMessage,
          pagesCompleted: data.pagesCompleted,
          storyTitle: data.title,
          deployInfo,
        })
        setErrorMessage(data.errorMessage || '')
        setErrorHint(hint)
        clearInterval(pollRef.current)
        clearInterval(messageRef.current)
        setError(true)
      } else if (data?.status === 'generating') {
        const statusChanged = lastStatusRef.current !== data.status
        lastStatusRef.current = data.status
        pollCountRef.current += 1
        if (statusChanged) {
          log('GeneratingStory', 'Generation in progress — illustrations can take 5–15 min', {
            storyId,
            title: data.title,
            pagesCompleted: data.pagesCompleted,
          })
        } else if (pollCountRef.current % GENERATING_HEARTBEAT_POLLS === 0) {
          const elapsedMin = Math.round((Date.now() - startedRef.current) / 60000)
          log('GeneratingStory', `Still generating (${elapsedMin} min elapsed)`, {
            storyId,
            pagesCompleted: data.pagesCompleted,
            totalPages: data.totalPages,
          })
        }
      } else if (data?.status === 'pending') {
        if (lastStatusRef.current !== data.status) {
          warn('GeneratingStory', 'Story still pending — edge function may not have started', { storyId })
        }
        lastStatusRef.current = data.status
      }
    }

    checkStatus()
    pollRef.current = setInterval(checkStatus, POLL_INTERVAL)

    const elapsedRef = setInterval(() => {
      setElapsedMin(Math.floor((Date.now() - startedRef.current) / 60000))
    }, 30000)

    return () => {
      clearInterval(elapsedRef)
      clearInterval(pollRef.current)
      clearInterval(messageRef.current)
    }
  }, [storyId])

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
            Checklist: (1) run <strong>migration_phase3.sql</strong> and <strong>migration_phase4.sql</strong> in Supabase SQL editor, (2){' '}
            <strong>supabase functions deploy generate-story</strong>, (3) confirm <strong>OPENAI_API_KEY</strong> has credits. For dev, set <strong>VITE_DEV_STORY_MODE=true</strong> (placeholders, fast). Full illustrations for 20 pages need a longer-running worker — Edge Functions cap at ~2.5–6.5 min.
          </p>
          <button
            onClick={() => navigate(childId ? `/child/${childId}/prompts` : -2)}
            style={{ background: 'var(--gold)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >
            Try again
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell childId={childId}>
      <div style={{ textAlign: 'center' }}>
        {/* Animated book */}
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
            ? `Painting page ${pagesCompleted} of ${STORY_PAGE_COUNT}…`
            : phase === 'preparing'
              ? 'Starting illustrations…'
              : phase === 'writing'
                ? 'Writing your story…'
                : MESSAGES[messageIndex]}
        </p>

        {/* Page progress */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
              {phase === 'illustrating' ? 'Illustrations' : 'Progress'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)' }}>
              {pagesCompleted} / {STORY_PAGE_COUNT} pages
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
              width: `${Math.round((pagesCompleted / STORY_PAGE_COUNT) * 100)}%`,
              background: 'linear-gradient(90deg, var(--gold), #e8a830)',
              borderRadius: 99,
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>
          This usually takes 10–25 minutes with illustrations. You can leave this page and come back!
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

        {elapsedMin >= 8 && pagesCompleted === 0 && (
          <div style={{
            marginBottom: 24,
            background: 'var(--rose-pale)',
            border: '1px solid rgba(192,83,74,0.2)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 13, color: 'var(--rose)', lineHeight: 1.6, marginBottom: 8 }}>
              <strong>Taking longer than expected.</strong> No pages saved yet after {elapsedMin} minutes — the edge function may not be deployed, or generation may have stalled.
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              Run <code style={{ fontSize: 11 }}>migration_phase3.sql</code> and{' '}
              <code style={{ fontSize: 11 }}>migration_phase4.sql</code>, then{' '}
              <code style={{ fontSize: 11 }}>supabase functions deploy generate-story</code>.
              Check Edge Function logs in the Supabase dashboard for errors.
            </p>
          </div>
        )}

        {/* Animated dots */}
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

        {/* Reassurance card */}
        <div style={{
          marginTop: 48,
          background: 'var(--gold-pale)',
          border: '1px solid rgba(200,136,42,0.2)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          textAlign: 'left'
        }}>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            💡 <strong>Tip:</strong> Your story will appear automatically when it's ready. We're writing the text and drawing 20 illustrations — all just for you!
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
