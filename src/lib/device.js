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
