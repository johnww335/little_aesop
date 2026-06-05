import { useState } from 'react'

export function Logo({ size = 'md' }) {
  const sizes = { sm: { icon: 28, title: 18 }, md: { icon: 40, title: 26 }, lg: { icon: 56, title: 36 } }
  const s = sizes[size]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={s.icon} height={s.icon} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="var(--gold)"/>
        <path d="M20 8C20 8 12 13 12 20C12 24 14 27 17 28.5L20 32L23 28.5C26 27 28 24 28 20C28 13 20 8 20 8Z" fill="var(--warm-white)" opacity="0.95"/>
        <path d="M20 8L20 32" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
        <circle cx="20" cy="19" r="3" fill="var(--gold)"/>
      </svg>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: s.title, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
        Little Aesop
      </span>
    </div>
  )
}

export function AuthCard({ children, title, subtitle }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--cream)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      backgroundImage: `radial-gradient(ellipse at 20% 50%, rgba(200,136,42,0.07) 0%, transparent 60%),
                        radial-gradient(ellipse at 80% 20%, rgba(45,90,61,0.06) 0%, transparent 50%)`
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Logo size="md" />
          </div>
          {title && (
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.5 }}>{subtitle}</p>
          )}
        </div>
        <div style={{
          background: 'var(--warm-white)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 28px',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)'
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function FormField({ label, id, error, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, letterSpacing: '0.01em' }}>
        {label}
      </label>
      {children}
      {error && <p style={{ fontSize: 12, color: 'var(--rose)', marginTop: 4 }}>{error}</p>}
    </div>
  )
}

export function Input({ error, style, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      {...props}
      onFocus={e => { setFocused(true); props.onFocus?.(e) }}
      onBlur={e => { setFocused(false); props.onBlur?.(e) }}
      style={{
        width: '100%',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        border: `1.5px solid ${error ? 'var(--rose)' : focused ? 'var(--gold)' : 'var(--border-strong)'}`,
        background: focused ? 'var(--warm-white)' : 'var(--cream)',
        color: 'var(--ink)',
        fontSize: 15,
        outline: 'none',
        transition: 'border-color 0.15s, background 0.15s',
        ...style
      }}
    />
  )
}

export function Select({ children, style, ...props }) {
  return (
    <select
      {...props}
      style={{
        width: '100%',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        border: '1.5px solid var(--border-strong)',
        background: 'var(--cream)',
        color: 'var(--ink)',
        fontSize: 15,
        outline: 'none',
        cursor: 'pointer',
        ...style
      }}
    >
      {children}
    </select>
  )
}

export function Button({ children, variant = 'primary', loading, disabled, style, ...props }) {
  const variants = {
    primary: {
      background: 'var(--gold)',
      color: 'var(--warm-white)',
      border: 'none',
      fontWeight: 700,
    },
    secondary: {
      background: 'transparent',
      color: 'var(--ink-soft)',
      border: '1.5px solid var(--border-strong)',
      fontWeight: 600,
    },
    ghost: {
      background: 'transparent',
      color: 'var(--gold)',
      border: 'none',
      fontWeight: 600,
    },
    danger: {
      background: 'var(--rose-pale)',
      color: 'var(--rose)',
      border: '1.5px solid rgba(192,83,74,0.2)',
      fontWeight: 600,
    }
  }
  return (
    <button
      {...props}
      disabled={disabled || loading}
      style={{
        ...variants[variant],
        padding: '10px 20px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        opacity: (disabled || loading) ? 0.6 : 1,
        transition: 'opacity 0.15s, transform 0.1s',
        width: '100%',
        cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
        ...style
      }}
    >
      {loading && (
        <span style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
      )}
      {children}
    </button>
  )
}

export function Alert({ type = 'error', children }) {
  const styles = {
    error: { bg: 'var(--rose-pale)', color: 'var(--rose)', border: 'rgba(192,83,74,0.2)' },
    success: { bg: 'var(--forest-pale)', color: 'var(--forest)', border: 'rgba(45,90,61,0.2)' },
    info: { bg: 'var(--gold-pale)', color: 'var(--gold)', border: 'rgba(200,136,42,0.2)' },
  }
  const s = styles[type]
  return (
    <div style={{
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 14,
      marginBottom: 16,
      lineHeight: 1.5
    }}>
      {children}
    </div>
  )
}

export function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      {label && <span style={{ fontSize: 12, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>{label}</span>}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}
