import { supabase } from './supabase'
import { log, warn, error as logError, logStoryText } from './logger'

export async function getRandomQuestions(count = 5) {
  const { data, error } = await supabase
    .from('question_bank')
    .select('*')
    .eq('active', true)

  if (error || !data) return { data: null, error }

  // Shuffle and pick count questions
  const shuffled = [...data].sort(() => Math.random() - 0.5)
  return { data: shuffled.slice(0, count), error: null }
}

export async function validateInputs(inputs) {
  if (import.meta.env.VITE_SKIP_CONTENT_VALIDATION === 'true') {
    log('Validation', 'Skipped (VITE_SKIP_CONTENT_VALIDATION=true)', { answerCount: inputs.length })
    return { safe: true }
  }

  log('Validation', 'Starting content validation', { answerCount: inputs.length })

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    logError('Validation', 'No active session')
    return { safe: false, reason: 'Please sign in again.', failedIndexes: [] }
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-inputs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ inputs }),
    }
  )

  const result = await response.json()

  if (!response.ok || result.error) {
    logError('Validation', 'Request failed', {
      status: response.status,
      error: result.error || result.reason,
      failedIndexes: result.failedIndexes,
    })
    return {
      safe: false,
      reason: result.error || result.reason || 'Could not validate your answers. Please try again.',
      failedIndexes: result.failedIndexes || [],
      failedReasons: result.failedReasons || {},
    }
  }

  if (result.safe === false) {
    warn('Validation', 'Answers flagged', {
      failedIndexes: result.failedIndexes,
      failedReasons: result.failedReasons,
      reason: result.reason,
    })
  } else {
    log('Validation', 'All answers passed')
  }

  return result
}

export async function createAndStartStory(childId, inputs) {
  log('Story', 'Creating story record', { childId, inputCount: inputs.length })

  const { data: story, error: createError } = await supabase
    .from('stories')
    .insert([{ child_id: childId, status: 'pending', inputs }])
    .select()
    .single()

  if (createError) {
    logError('Story', 'Failed to insert story row', { message: createError.message, code: createError.code })
    const message = createError.message?.includes('Failed to fetch')
      ? 'Could not reach Supabase. Check your internet connection and make sure your Supabase project is active (not paused) in the dashboard.'
      : createError.message
    return { data: null, error: { ...createError, message } }
  }

  log('Story', 'Story record created', { storyId: story.id, status: story.status })

  const { data: { session } } = await supabase.auth.getSession()
  const devMode = import.meta.env.VITE_DEV_STORY_MODE === 'true'
  const allowTemplate = import.meta.env.VITE_ALLOW_TEMPLATE_STORY === 'true'
  const dallePageLimit = devMode ? 0 : getDallePageLimitFromEnv()

  log('Story', 'Triggering generate-story edge function', { storyId: story.id, devMode, allowTemplate, dallePageLimit })
  if (!devMode && dallePageLimit < STORY_PAGE_COUNT) {
    log('Story', 'Partial illustrations — first pages illustrated, rest placeholders', {
      dallePageLimit,
      placeholderPages: STORY_PAGE_COUNT - dallePageLimit,
    })
  }

  fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-story`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ storyId: story.id, childId, inputs, devMode, allowTemplate, dallePageLimit }),
    }
  )
    .then(async (res) => {
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        logError('Story', 'generate-story returned error', { storyId: story.id, status: res.status, body })
      } else {
        log('Story', 'generate-story acknowledged', {
          storyId: story.id,
          status: res.status,
          devModeSent: devMode,
          functionVersion: body.functionVersion,
          message: body.message,
          hasOpenAiKey: body.hasOpenAiKey,
        })
        try {
          sessionStorage.setItem(`story-deploy-${story.id}`, JSON.stringify({
            functionVersion: body.functionVersion ?? null,
            hasOpenAiKey: body.hasOpenAiKey ?? null,
            message: body.message ?? null,
          }))
        } catch {
          // ignore
        }
        if (devMode) {
          warn('Story', '⚠️  devMode=true sent to edge function — images will be placeholders', { storyId: story.id })
        }
        if (body.functionVersion !== '2025-06-13') {
          warn('Story', '⚠️  Old edge function still running — deploy generate-story to get GPT stories', {
            deployedVersion: body.functionVersion ?? 'unknown (pre-version)',
          })
        }
        if (body.error || body.success === false) {
          logError('Story', 'generate-story failed', {
            storyId: story.id,
            error: body.error,
            hasOpenAiKey: body.hasOpenAiKey,
          })
        }
        if (body.hasOpenAiKey === false) {
          warn('Story', '⚠️  OPENAI_API_KEY is not set on the edge function — stories cannot be generated by GPT', { storyId: story.id })
        }
        if (devMode && body.debugStory) {
          if (body.debugStory.meta?.usedFallback) {
            warn('Story', '⚠️  PLACEHOLDER STORY — not GPT. Set OPENAI_API_KEY in Supabase secrets and redeploy.', {
              reason: body.debugStory.meta.fallbackReason,
            })
          }
          logStoryText(story.id, body.debugStory)
        }
      }
    })
    .catch((err) => {
      logError('Story', 'generate-story request failed (network)', { storyId: story.id, message: err.message })
    })

  return { data: story, error: null }
}

export const STORY_PAGE_COUNT = 20

export function getDallePageLimitFromEnv() {
  const raw = import.meta.env.VITE_DALLE_PAGE_LIMIT
  if (raw === undefined || raw === '') return STORY_PAGE_COUNT
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return STORY_PAGE_COUNT
  return Math.min(parsed, STORY_PAGE_COUNT)
}

const STORY_PROGRESS_SELECT_FULL = `
  id, status, title, child_id, pages_completed, error_message,
  pages (page_number)
`

const STORY_PROGRESS_SELECT_BASE = `
  id, status, title, child_id, error_message,
  pages (page_number)
`

export function getStoredDeployInfo(storyId) {
  try {
    const raw = sessionStorage.getItem(`story-deploy-${storyId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function inferGenerationErrorHint({ errorMessage, pagesCompleted, storyTitle, deployInfo }) {
  if (errorMessage) return errorMessage

  const hints = []
  const version = deployInfo?.functionVersion
  if (!version || version !== '2025-06-13') {
    hints.push(`Edge function not up to date (deployed: ${version ?? 'unknown'}). Run: supabase functions deploy generate-story`)
  }
  if (deployInfo?.hasOpenAiKey === false) {
    hints.push('OPENAI_API_KEY is not set in Supabase Edge Function secrets.')
  }
  if (pagesCompleted > 0) {
    hints.push(`Failed after ${pagesCompleted} of ${STORY_PAGE_COUNT} pages were saved.`)
  } else if (storyTitle) {
    hints.push('Story text was written but illustration generation failed. Check OpenAI billing, GPT Image access, migration_phase4.sql (storage bucket), and Edge Function logs.')
  } else {
    hints.push('Failed before any pages were saved — likely during story writing. Check OPENAI_API_KEY, billing, and Edge Function logs.')
  }
  hints.push('Edge Functions have a wall-clock limit (150s free / 400s paid). Twenty GPT Image illustrations usually exceeds this — use VITE_DEV_STORY_MODE=true for dev, or split generation across jobs.')
  return hints.join(' ')
}

function isMissingColumnError(error) {
  const msg = error?.message?.toLowerCase() ?? ''
  return msg.includes('pages_completed') || msg.includes('error_message') || msg.includes('column')
}

export async function getStoryProgress(storyId) {
  let result = await supabase
    .from('stories')
    .select(STORY_PROGRESS_SELECT_FULL)
    .eq('id', storyId)
    .single()

  if (result.error && isMissingColumnError(result.error)) {
    warn('Story', 'Progress columns missing — run migration_phase3.sql', { storyId })
    result = await supabase
      .from('stories')
      .select(STORY_PROGRESS_SELECT_BASE)
      .eq('id', storyId)
      .single()
  }

  const { data, error } = result
  if (error) {
    logError('Story', 'Failed to poll story progress', { storyId, message: error.message })
    return { data: null, error }
  }

  const pagesInDb = data.pages?.length ?? 0
  const pagesCompleted = Math.max(data.pages_completed ?? 0, pagesInDb)
  return {
    data: {
      id: data.id,
      status: data.status,
      title: data.title,
      childId: data.child_id,
      errorMessage: data.error_message ?? null,
      pagesCompleted,
      totalPages: STORY_PAGE_COUNT,
    },
    error: null,
  }
}

/** @deprecated Use getStoryProgress — kept for simple status-only checks */
export async function getStoryStatus(storyId) {
  const { data, error } = await getStoryProgress(storyId)
  if (error || !data) return { data: null, error }
  return {
    data: { id: data.id, status: data.status, title: data.title },
    error: null,
  }
}

export async function getStoriesForChild(childId) {
  const { data, error } = await supabase
    .from('stories')
    .select(`
      id, title, status, created_at, pages_completed,
      pages (image_url, page_number)
    `)
    .eq('child_id', childId)
    .in('status', ['pending', 'generating', 'ready'])
    .order('created_at', { ascending: false })

  if (data) {
    for (const story of data) {
      if (story.pages) {
        story.pages.sort((a, b) => a.page_number - b.page_number)
      }
    }
  }

  return { data, error }
}

export async function getStoryWithPages(storyId) {
  const { data, error } = await supabase
    .from('stories')
    .select(`
      id, title, status, created_at, child_id,
      pages (id, page_number, text_content, image_url)
    `)
    .eq('id', storyId)
    .single()

  if (data?.pages) {
    data.pages.sort((a, b) => a.page_number - b.page_number)
  }

  return { data, error }
}
