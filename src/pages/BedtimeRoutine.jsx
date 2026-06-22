import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getStoryProgress, resumeStoryIllustration, getIllustrationTargetFromEnv, STORY_PAGE_COUNT } from '../lib/stories'
import { getChildById } from '../lib/children'
import { Button } from '../components/ui'
import AppHeader from '../components/AppHeader'
import { STORY_CREATION_ESTIMATE_MINUTES } from '../lib/onboarding'

const ROUTINE_STEPS = [
  { emoji: '🦷', label: 'Brush your teeth' },
  { emoji: '👕', label: 'Put on pajamas' },
  { emoji: '🚿', label: 'Wash your face' },
  { emoji: '🧸', label: 'Pick a stuffed friend' },
]

function resolvePhase(status, illustratedCount, pagesInDb, hasTitle) {
  if (status === 'pending') return 'starting'
  if (status === 'generating') {
    if (illustratedCount > 0) return 'illustrating'
    if (pagesInDb > 0 || hasTitle) return 'preparing'
    return 'writing'
  }
  return 'starting'
}

function phaseLabel(phase, illustratedCount, illustrationTarget) {
  if (phase === 'illustrating') return `Painting illustration ${illustratedCount} of ${illustrationTarget}…`
  if (phase === 'preparing') return 'Starting illustrations…'
  if (phase === 'writing') return 'Writing your story…'
  return 'Getting your story ready…'
}

export default function BedtimeRoutine() {
  const { storyId, childId } = useParams()
  const navigate = useNavigate()
  const [childName, setChildName] = useState('')
  const [storyTitle, setStoryTitle] = useState('')
  const [status, setStatus] = useState('pending')
  const [pagesInDb, setPagesInDb] = useState(0)
  const [illustratedCount, setIllustratedCount] = useState(0)
  const [resumeLoading, setResumeLoading] = useState(false)
  const [resumeMessage, setResumeMessage] = useState('')
  const illustrationTarget = getIllustrationTargetFromEnv() || 20

  useEffect(() => {
    if (!childId) return
    getChildById(childId).then(({ data }) => {
      if (data?.name) setChildName(data.name)
    })
  }, [childId])

  useEffect(() => {
    let active = true

    const poll = async () => {
      const { data } = await getStoryProgress(storyId)
      if (!active || !data) return
      if (data.title) setStoryTitle(data.title)
      setStatus(data.status)
      setPagesInDb(data.pagesInDb)
      setIllustratedCount(data.illustratedCount)
      if (data.status === 'ready') {
        navigate(`/story/${storyId}/read`, { replace: true })
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [storyId, navigate])

  const name = childName || 'friend'
  const canResume = illustratedCount > 0 && illustratedCount < illustrationTarget
  const phase = resolvePhase(status, illustratedCount, pagesInDb, Boolean(storyTitle))
  const progressTarget = phase === 'illustrating' ? illustrationTarget : STORY_PAGE_COUNT
  const progressValue = phase === 'illustrating'
    ? illustratedCount
    : pagesInDb > 0 ? pagesInDb : (storyTitle ? 1 : 0)
  const progressPct = Math.min(100, Math.round((progressValue / progressTarget) * 100))

  const handleResume = async () => {
    setResumeLoading(true)
    setResumeMessage('')
    const { error } = await resumeStoryIllustration(storyId)
    setResumeLoading(false)
    if (error) {
      setResumeMessage(error.message)
    } else {
      setResumeMessage('Picking up where we left off…')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--cream)',
      backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(90,70,140,0.08) 0%, transparent 55%)',
    }}>
      <AppHeader childId={childId} />
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px 48px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16, lineHeight: 1 }}>🌙</div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 600,
          color: 'var(--ink)',
          marginBottom: 12,
          lineHeight: 1.3,
        }}>
          Time to get ready for bed, {name}!
        </h1>

        <p style={{
          fontSize: 17,
          color: 'var(--ink-soft)',
          lineHeight: 1.65,
          marginBottom: 28,
        }}>
          While you get ready, we're writing a special story just for you
          {storyTitle ? (
            <>
              {' '}
              —
              <em style={{ fontStyle: 'italic' }}> {storyTitle}</em>
            </>
          ) : null}
          . Take your time — we'll keep working in the background.
        </p>

        <div style={{
          background: 'var(--warm-white)',
          border: '2px solid var(--ink)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          marginBottom: 28,
          textAlign: 'left',
          boxShadow: 'var(--shadow-bold)',
        }}>
          <p style={{
            fontSize: 15,
            color: 'var(--ink-soft)',
            marginBottom: 14,
            fontStyle: 'italic',
            textAlign: 'center',
          }}>
            {phaseLabel(phase, illustratedCount, illustrationTarget)}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)', fontWeight: 600 }}>
              {phase === 'illustrating' ? 'Illustrations' : 'Progress'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)' }}>
              {phase === 'illustrating'
                ? `${illustratedCount} / ${illustrationTarget}`
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
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, var(--gold), var(--gold-light))',
              borderRadius: 99,
              transition: 'width 0.6s ease',
            }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 10, textAlign: 'center' }}>
            About {STORY_CREATION_ESTIMATE_MINUTES} minutes total — we'll open the story when it's ready
          </p>
        </div>

        <div style={{
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 22px',
          marginBottom: 28,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Your bedtime checklist
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {ROUTINE_STEPS.map((step) => (
              <li key={step.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 16, color: 'var(--ink)' }}>
                <span style={{ fontSize: 24, width: 32, textAlign: 'center', flexShrink: 0 }}>{step.emoji}</span>
                {step.label}
              </li>
            ))}
          </ul>
        </div>

        {canResume && (
          <div style={{ marginBottom: 20 }}>
            <button
              type="button"
              onClick={handleResume}
              disabled={resumeLoading}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--ink-soft)',
                cursor: resumeLoading ? 'wait' : 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              {resumeLoading ? 'Resuming…' : 'Illustrations stuck? Resume →'}
            </button>
            {resumeMessage && (
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 10 }}>{resumeMessage}</p>
            )}
          </div>
        )}

        <Button onClick={() => navigate(`/story/${storyId}/generating`)} style={{ width: '100%', maxWidth: 320 }}>
          I'm ready for my story →
        </Button>

        <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 20, lineHeight: 1.5 }}>
          No rush — your story should be ready in about {STORY_CREATION_ESTIMATE_MINUTES} minutes and will open automatically when every page is illustrated.
        </p>
      </main>
    </div>
  )
}
