import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

export function Logo({ size = 'md', to = '/', className = '' }) {
  const gradId = useId()
  const sizes = { sm: { icon: 28, title: 18 }, md: { icon: 40, title: 26 }, lg: { icon: 56, title: 36 } }
  const s = sizes[size]
  return (
    <Link
      to={to}
      aria-label="Little Aesop home"
      className={`app-logo${className ? ` ${className}` : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}
    >
      <span className="app-logo-mark" aria-hidden="true">
        <svg
          width={s.icon}
          height={s.icon}
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          shapeRendering="geometricPrecision"
        >
          <defs>
            <linearGradient id={gradId} x1="20" y1="4" x2="20" y2="36" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--gold-light)" />
              <stop offset="1" stopColor="var(--gold-bold)" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx="11" fill={`url(#${gradId})`} />
          <path
            d="M20 9.5C20 9.5 13.25 13.75 13.25 19.75C13.25 23.35 15 26 17.35 27.35L20 30.25L22.65 27.35C25 26 26.75 23.35 26.75 19.75C26.75 13.75 20 9.5 20 9.5Z"
            fill="var(--warm-white)"
          />
          <circle cx="20" cy="19" r="2.75" fill="var(--ink)" opacity="0.88" />
        </svg>
      </span>
      <span
        className="app-logo-text"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: s.title,
          color: 'var(--ink)',
          letterSpacing: '-0.03em',
          whiteSpace: 'nowrap',
        }}
      >
        Little Aesop
      </span>
    </Link>
  )
}

export function AuthCard({ children, title, subtitle }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--hero-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Logo size="md" />
          </div>
          {title && (
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginBottom: 8, letterSpacing: '-0.02em' }}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p style={{ fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{subtitle}</p>
          )}
        </div>
        <div style={{
          background: 'var(--warm-white)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 28px',
          boxShadow: 'var(--shadow-lg)',
          border: '2px solid var(--ink)',
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
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6, letterSpacing: '0.01em' }}>
        {label}
      </label>
      {children}
      {error && <p style={{ fontSize: 12, color: 'var(--rose)', marginTop: 4, fontWeight: 600 }}>{error}</p>}
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
        padding: '12px 14px',
        borderRadius: 'var(--radius-sm)',
        border: `2px solid ${error ? 'var(--rose)' : focused ? 'var(--ink)' : 'var(--border-strong)'}`,
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
        padding: '12px 14px',
        borderRadius: 'var(--radius-sm)',
        border: '2px solid var(--border-strong)',
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
      background: 'var(--ink)',
      color: 'var(--cream)',
      border: '2px solid var(--ink)',
      fontWeight: 800,
      boxShadow: 'var(--shadow-bold)',
    },
    secondary: {
      background: 'transparent',
      color: 'var(--ink-soft)',
      border: '2px solid var(--border-strong)',
      fontWeight: 700,
    },
    ghost: {
      background: 'transparent',
      color: 'var(--ink)',
      border: 'none',
      fontWeight: 700,
    },
    danger: {
      background: 'var(--rose-pale)',
      color: 'var(--rose)',
      border: '2px solid rgba(214,69,69,0.25)',
      fontWeight: 700,
    }
  }
  return (
    <button
      {...props}
      disabled={disabled || loading}
      style={{
        ...variants[variant],
        padding: '12px 22px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        opacity: (disabled || loading) ? 0.6 : 1,
        transition: 'opacity 0.15s, transform 0.1s',
        width: '100%',
        cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
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
    error: { bg: 'var(--rose-pale)', color: 'var(--rose)', border: 'rgba(214,69,69,0.25)' },
    success: { bg: 'var(--forest-pale)', color: 'var(--forest)', border: 'rgba(26,107,79,0.25)' },
    info: { bg: 'var(--gold-pale)', color: 'var(--ink-soft)', border: 'rgba(126, 107, 184, 0.25)' },
  }
  const s = styles[type]
  return (
    <div style={{
      background: s.bg,
      color: s.color,
      border: `2px solid ${s.border}`,
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
      fontSize: 14,
      marginBottom: 16,
      lineHeight: 1.5,
      fontWeight: 600,
    }}>
      {children}
    </div>
  )
}

export function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
      <div style={{ flex: 1, height: 2, background: 'var(--border)' }} />
      {label && <span style={{ fontSize: 12, color: 'var(--ink-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>{label}</span>}
      <div style={{ flex: 1, height: 2, background: 'var(--border)' }} />
    </div>
  )
}
