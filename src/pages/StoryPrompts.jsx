import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getRandomQuestions, validateInputs, createAndStartStory } from '../lib/stories'
import { log, error as logError } from '../lib/logger'
import { Button, Alert } from '../components/ui'
import AppHeader from '../components/AppHeader'

export default function StoryPrompts() {
  const { childId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    loadQuestions()
  }, [])

  const loadQuestions = async () => {
    setLoading(true)
    const { data, error } = await getRandomQuestions(5)
    setLoading(false)
    if (error || !data) { setError('Could not load questions. Please try again.'); return }
    setQuestions(data)
  }

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    setFieldErrors(prev => ({ ...prev, [questionId]: '' }))
  }

  const handleNext = () => {
    const q = questions[currentStep]
    if (!answers[q.id]?.trim()) {
      setFieldErrors(prev => ({ ...prev, [q.id]: 'Please enter an answer to continue' }))
      return
    }
    setCurrentStep(prev => prev + 1)
  }

  const handleBack = () => setCurrentStep(prev => prev - 1)

  const handleSubmit = async () => {
    // Validate all answers filled
    const missing = questions.filter(q => !answers[q.id]?.trim())
    if (missing.length) {
      setError('Please answer all questions before creating your story.')
      return
    }

    setSubmitting(true)
    setError('')
    setFieldErrors({})

    const inputs = questions.map(q => ({
      question: q.prompt_text,
      answer: answers[q.id].trim()
    }))

    log('StoryPrompts', 'Submit started', { childId, questionCount: questions.length })

    // Content validation
    const validation = await validateInputs(inputs)
    if (!validation.safe) {
      setSubmitting(false)
      logError('StoryPrompts', 'Validation blocked submit', {
        reason: validation.reason,
        failedIndexes: validation.failedIndexes,
      })

      const errors = {}
      for (const index of validation.failedIndexes || []) {
        const q = questions[index - 1]
        if (q) errors[q.id] = validation.failedReasons?.[index] || 'Please try a different answer'
      }
      setFieldErrors(errors)
      setError(validation.reason || `One of your answers isn't quite right for a children's story.`)
      setCurrentStep(questions.length)
      return
    }

    // Create story and kick off generation
    const { data: story, error: storyError } = await createAndStartStory(childId, inputs)
    setSubmitting(false)

    if (storyError) {
      logError('StoryPrompts', 'Story creation failed', { message: storyError.message })
      setError(storyError.message)
      return
    }

    log('StoryPrompts', 'Navigating to generating page', { storyId: story.id })
    navigate(`/story/${story.id}/generating`)
  }

  const isLastStep = currentStep === questions.length - 1
  const isReviewStep = currentStep === questions.length

  if (loading) {
    return (
      <PageShell childId={childId}>
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-muted)' }}>
          <Spinner />
          <p style={{ marginTop: 12 }}>Getting your questions ready…</p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell childId={childId}>
      {/* Progress bar */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            {isReviewStep ? 'Ready to create!' : `Question ${currentStep + 1} of ${questions.length}`}
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            {Math.round(((isReviewStep ? questions.length : currentStep) / questions.length) * 100)}%
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: 'var(--gold)',
            borderRadius: 99,
            width: `${((isReviewStep ? questions.length : currentStep) / questions.length) * 100}%`,
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {/* Question step */}
      {!isReviewStep && questions[currentStep] && (
        <div key={currentStep} style={{ animation: 'fadeIn 0.2s ease' }}>
          <div style={{
            background: 'var(--gold-pale)',
            border: '1px solid rgba(200,136,42,0.2)',
            borderRadius: 'var(--radius-lg)',
            padding: '28px 24px',
            marginBottom: 24,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4 }}>
              {questions[currentStep].prompt_text}
            </h2>
          </div>
          <input
            autoFocus
            type="text"
            placeholder="Type your answer here…"
            value={answers[questions[currentStep].id] || ''}
            onChange={e => handleAnswer(questions[currentStep].id, e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (isLastStep ? null : handleNext())}
            maxLength={100}
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 'var(--radius-md)',
              border: `1.5px solid ${fieldErrors[questions[currentStep].id] ? 'var(--rose)' : 'var(--border-strong)'}`,
              background: 'var(--warm-white)',
              fontSize: 17,
              color: 'var(--ink)',
              outline: 'none',
              marginBottom: 4
            }}
          />
          {fieldErrors[questions[currentStep].id] && (
            <p style={{ fontSize: 12, color: 'var(--rose)', marginBottom: 8 }}>
              {fieldErrors[questions[currentStep].id]}
            </p>
          )}
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 20, textAlign: 'right' }}>
            {(answers[questions[currentStep].id] || '').length}/100
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            {currentStep > 0 && (
              <Button variant="secondary" onClick={handleBack} style={{ flex: 1 }}>← Back</Button>
            )}
            <Button onClick={isLastStep ? () => setCurrentStep(questions.length) : handleNext} style={{ flex: 2 }}>
              {isLastStep ? 'Review answers →' : 'Next →'}
            </Button>
          </div>
        </div>
      )}

      {/* Review step */}
      {isReviewStep && (
        <div style={{ animation: 'fadeIn 0.2s ease' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--ink)', marginBottom: 20, textAlign: 'center' }}>
            Here's what goes in your story
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            {questions.map((q, i) => (
              <div key={q.id} style={{
                background: fieldErrors[q.id] ? 'var(--rose-pale)' : 'var(--warm-white)',
                border: `1.5px solid ${fieldErrors[q.id] ? 'var(--rose)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12
              }}>
                <span style={{ background: fieldErrors[q.id] ? 'var(--rose)' : 'var(--gold)', color: 'white', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 2 }}>{q.prompt_text}</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{answers[q.id]}</p>
                  {fieldErrors[q.id] && (
                    <p style={{ fontSize: 12, color: 'var(--rose)', marginTop: 6 }}>{fieldErrors[q.id]}</p>
                  )}
                </div>
                <button
                  onClick={() => setCurrentStep(i)}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--gold)', fontWeight: 600, flexShrink: 0 }}
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" onClick={() => setCurrentStep(questions.length - 1)} style={{ flex: 1 }}>← Back</Button>
            <Button onClick={handleSubmit} loading={submitting} style={{ flex: 2 }}>
              ✨ Create my story!
            </Button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </PageShell>
  )
}

function PageShell({ children, childId }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', backgroundImage: `radial-gradient(ellipse at 80% 0%, rgba(200,136,42,0.08) 0%, transparent 50%)` }}>
      <AppHeader childId={childId} />
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, textAlign: 'center' }}>
          Build your story
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 36 }}>
          Answer a few questions and we'll write a story just for you.
        </p>
        {children}
      </main>
    </div>
  )
}

function Spinner() {
  return <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
}
