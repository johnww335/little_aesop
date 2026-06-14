import { Button } from './ui'

export default function OnboardingModal({ title, children, onDismiss, dismissLabel = 'Got it' }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onClick={e => e.target === e.currentTarget && onDismiss()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(44,26,14,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(3px)',
      }}
    >
      <div style={{
        background: 'var(--warm-white)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 24px',
        width: '100%',
        maxWidth: 440,
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
        textAlign: 'left',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }} aria-hidden="true">✨</div>
        <h2
          id="onboarding-title"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: 12,
            lineHeight: 1.3,
          }}
        >
          {title}
        </h2>
        <div style={{ fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.65, marginBottom: 24 }}>
          {children}
        </div>
        <Button onClick={onDismiss} style={{ width: '100%' }}>
          {dismissLabel}
        </Button>
      </div>
    </div>
  )
}
