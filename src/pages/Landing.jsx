import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { Logo } from '../components/ui'
import { STORY_CREATION_ESTIMATE_MINUTES } from '../lib/onboarding'
import './Landing.css'

const STEPS = [
  {
    num: 1,
    title: 'Add your child',
    text: 'Create a profile with their name and age so every story is written just for them.',
  },
  {
    num: 2,
    title: 'Answer a few questions',
    text: 'Fun prompts about animals, places, and favorites — their answers become the plot.',
  },
  {
    num: 3,
    title: 'Get a illustrated book',
    text: `We write and paint a unique 20-page story in about ${STORY_CREATION_ESTIMATE_MINUTES} minutes.`,
  },
]

const EXPECTATIONS = [
  { icon: '📖', text: '20-page personalized story, written and illustrated from scratch' },
  { icon: '⏱️', text: `Ready in about ${STORY_CREATION_ESTIMATE_MINUTES} minutes — start bedtime prep while we work` },
  { icon: '✨', text: 'Every book is unique — no two stories are the same' },
  { icon: '📱', text: 'Read on phone or iPad with swipe-to-turn pages and immersive mode' },
]

const PREVIEWS = [
  {
    src: '/landing/preview-questions.svg',
    title: 'Answer fun prompts',
    caption: 'Kids share ideas; we weave them into the adventure.',
    wide: false,
  },
  {
    src: '/landing/preview-spread.svg',
    title: 'Illustrated page spreads',
    caption: 'Hand-drawn style art paired with story text on every page.',
    wide: true,
  },
  {
    src: '/landing/preview-bookshelf.svg',
    title: 'Your bookshelf',
    caption: 'All your child\'s stories in one place — ready to re-read anytime.',
    wide: false,
  },
]

export default function Landing() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, loading, navigate])

  if (loading || user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--hero-bg)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  return (
    <div className="landing">
      <nav className="landing-nav">
        <Logo size="sm" className="landing-logo" />
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-nav-link">Sign in</Link>
          <Link to="/signup" className="landing-nav-cta">Get started</Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-blob landing-hero-blob-1" aria-hidden="true" />
        <div className="landing-hero-blob landing-hero-blob-2" aria-hidden="true" />
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <h1>Bedtime stories written just for your child</h1>
            <p>
              Little Aesop turns your kid&apos;s answers into a one-of-a-kind illustrated
              storybook — new adventures every night, starring them.
            </p>
            <div className="landing-hero-ctas">
              <Link to="/signup" className="landing-btn-primary">Create free account</Link>
              <Link to="/login" className="landing-btn-secondary">Sign in</Link>
            </div>
          </div>
          <div className="landing-hero-visual">
            <img
              className="landing-hero-book"
              src="/landing/preview-spread.svg"
              alt="Preview of an illustrated story spread with art on one page and story text on the other"
            />
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>How it works</h2>
          <p>Three simple steps from idea to illustrated storybook.</p>
        </div>
        <div className="landing-steps">
          {STEPS.map((step) => (
            <article key={step.num} className="landing-step">
              <span className="landing-step-num">{step.num}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-expectations">
          <div>
            <h2>What to expect</h2>
            <p>
              Little Aesop is built for real bedtime routines — quick to start,
              delightful to read, and honest about timing.
            </p>
          </div>
          <ul className="landing-expect-list">
            {EXPECTATIONS.map((item) => (
              <li key={item.text}>
                <span className="landing-expect-icon" aria-hidden="true">{item.icon}</span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>Inside the app</h2>
          <p>A peek at the experience — from questions to finished book.</p>
        </div>
        <div className="landing-previews">
          {PREVIEWS.map((preview) => (
            <article
              key={preview.title}
              className={`landing-preview-card${preview.wide ? ' landing-preview-card--wide' : ''}`}
            >
              <img src={preview.src} alt="" />
              <div className="landing-preview-caption">
                <h3>{preview.title}</h3>
                <p>{preview.caption}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Ready for tonight&apos;s story?</h2>
        <p>Create an account and make your first book in minutes.</p>
        <Link to="/signup" className="landing-btn-primary">Get started free</Link>
      </section>

      <footer className="landing-footer">
        © {new Date().getFullYear()} Little Aesop — personalized stories for children
      </footer>
    </div>
  )
}
