import { useEffect, useState } from 'react'

export const ONBOARDING_STEPS = {
  WELCOME: 'welcome',
  BOOKSHELF: 'bookshelf',
  NEW_STORY: 'new-story',
}

/** Shown to users while story text + illustrations are generated. */
export const STORY_CREATION_ESTIMATE_MINUTES = 5

function storageKey(userId, step) {
  return `little-aesop-onboarding-${userId}-${step}`
}

export function hasCompletedOnboarding(userId, step) {
  if (!userId) return true
  try {
    return localStorage.getItem(storageKey(userId, step)) === '1'
  } catch {
    return true
  }
}

export function completeOnboarding(userId, step) {
  if (!userId) return
  try {
    localStorage.setItem(storageKey(userId, step), '1')
  } catch {
    // ignore
  }
}

export function useOnboarding(userId, step, ready = true) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!ready || !userId) return
    setShow(!hasCompletedOnboarding(userId, step))
  }, [userId, step, ready])

  const dismiss = () => {
    completeOnboarding(userId, step)
    setShow(false)
  }

  return { show, dismiss }
}
