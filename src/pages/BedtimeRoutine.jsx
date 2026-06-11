import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getStoryProgress, resumeStoryIllustration, getIllustrationTargetFromEnv } from '../lib/stories'
import { getChildById } from '../lib/children'
import { Button } from '../components/ui'
import AppHeader from '../components/AppHeader'

const ROUTINE_STEPS = [
  { emoji: '🦷', label: 'Brush your teeth' },
  { emoji: '👕', label: 'Put on pajamas' },
  { emoji: '🚿', label: 'Wash your face' },
  { emoji: '🧸', label: 'Pick a stuffed friend' },
]

export default function BedtimeRoutine() {
  const { storyId, childId } = useParams()
  const navigate = useNavigate()
  const [childName, setChildName] = useState('')
  const [storyTitle, setStoryTitle] = useState('')
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
      setIllustratedCount(data.illustratedCount)
      if (data.status === 'ready') {
        navigate(`/story/${storyId}/read`, { replace: true })
      }
    }

    poll()
    const interval = setInterval(poll, 8000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [storyId, navigate])

  const name = childName || 'friend'
  const canResume = illustratedCount > 0 && illustratedCount < illustrationTarget

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
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 22px',
          marginBottom: 28,
          textAlign: 'left',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Your bedtime checklist
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ROUTINE_STEPS.map((step) => (
              <li key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, color: 'var(--ink)' }}>
                <span style={{ fontSize: 24, width: 32, textAlign: 'center' }}>{step.emoji}</span>
                {step.label}
              </li>
            ))}
          </ul>
        </div>

        {illustratedCount > 0 && (
          <p style={{ fontSize: 14, color: 'var(--gold)', fontWeight: 600, marginBottom: 20 }}>
            ✨ {illustratedCount} of {illustrationTarget} illustration{illustratedCount === 1 ? '' : 's'} ready so far…
          </p>
        )}

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
          No rush — your story will open automatically when every page is illustrated.
        </p>
      </main>
    </div>
  )
}
