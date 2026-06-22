import { useState, useEffect } from 'react'

/** iPhone, iPad, or iPad-as-Macintosh (iOS 13+ desktop UA). */
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
  )
}

/** Opened from home screen — no Safari/Chrome browser chrome. */
export function isStandalonePWA() {
  if (typeof window === 'undefined') return false
  return (
    window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches
  )
}

/** Desktop/Android can hide browser UI via Fullscreen API; iPad browsers cannot. */
export function supportsNativeElementFullscreen() {
  if (isIOS()) return false
  const el = typeof document !== 'undefined' ? document.documentElement : null
  return !!(el?.requestFullscreen || el?.webkitRequestFullscreen)
}

export function needsHomeScreenInstallForTrueFullscreen() {
  return isIOS() && !isStandalonePWA()
}

/** Match a CSS media query (updates on resize / orientation change). */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    setMatches(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Phones and narrow portrait — single-page story reader. */
export function useNarrowViewport() {
  return useMediaQuery('(max-width: 720px)')
}
