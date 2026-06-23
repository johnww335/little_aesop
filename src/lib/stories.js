import { supabase } from './supabase'
import { log, warn, error as logError, logStoryText, logStoryMetadata, isPlaceholderImage } from './logger'

export const ILLUSTRATION_BATCH_SIZE = 5

/** How many pages get real illustrations on create (default: full book). */
export function getIllustrationTargetFromEnv() {
  if (import.meta.env.VITE_DEV_STORY_MODE === 'true') return 0
  const raw = import.meta.env.VITE_ILLUSTRATION_TARGET
  if (raw === undefined || raw === '') return STORY_PAGE_COUNT
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return STORY_PAGE_COUNT
  return Math.min(parsed, STORY_PAGE_COUNT)
}

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
  const illustrationTarget = getIllustrationTargetFromEnv()

  log('Story', 'Triggering generate-story edge function', {
    storyId: story.id, devMode, allowTemplate, illustrationTarget,
  })
  if (!devMode && illustrationTarget > 0) {
    log('Story', 'Full illustration run', {
      illustrationTarget,
      batches: Math.ceil(illustrationTarget / ILLUSTRATION_BATCH_SIZE),
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
      body: JSON.stringify({
        storyId: story.id,
        childId,
        inputs,
        devMode,
        allowTemplate,
        illustrationTarget,
      }),
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
          storeDeployInfo(story.id, {
            functionVersion: body.functionVersion ?? null,
            hasOpenAiKey: body.hasOpenAiKey ?? null,
            message: body.message ?? null,
          })
        } catch {
          // ignore
        }
        if (devMode) {
          warn('Story', '⚠️  devMode=true sent to edge function — images will be placeholders', { storyId: story.id })
        }
        if (body.functionVersion !== EXPECTED_FUNCTION_VERSION) {
          warn('Story', '⚠️  Old edge function still running — deploy generate-story to get latest fixes', {
            deployedVersion: body.functionVersion ?? 'unknown (pre-version)',
            expectedVersion: EXPECTED_FUNCTION_VERSION,
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
        if (body.debugStory?.storyMetadata) {
          logStoryMetadata(story.id, body.debugStory.storyMetadata)
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

/** @deprecated Initial stories always get one batch; use illustrateNextBatch for more. */
export function getDallePageLimitFromEnv() {
  const raw = import.meta.env.VITE_DALLE_PAGE_LIMIT
  if (raw === undefined || raw === '') return ILLUSTRATION_BATCH_SIZE
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return ILLUSTRATION_BATCH_SIZE
  return Math.min(parsed, STORY_PAGE_COUNT)
}

export function isDevAdmin(user) {
  const adminEmail = import.meta.env.VITE_DEV_ADMIN_EMAIL?.trim().toLowerCase()
  if (!adminEmail || !user?.email) return false
  return user.email.toLowerCase() === adminEmail
}

export function countPlaceholderPages(pages) {
  if (!pages?.length) return 0
  return pages.filter((p) => isPlaceholderImage(p.image_url)).length
}

export const EXPECTED_FUNCTION_VERSION = '2026-06-24'

export async function resumeStoryIllustration(storyId) {
  log('Story', 'Resuming illustration chain', { storyId })

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return { data: null, error: { message: 'Please sign in again.' } }
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-story`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        storyId,
        mode: 'resume_illustrations',
        illustrationTarget: getIllustrationTargetFromEnv(),
      }),
    }
  )

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    logError('Story', 'Resume illustration rejected', { storyId, status: response.status, error: result.error })
    return { data: null, error: { message: result.error || 'Could not resume illustrations.' } }
  }

  log('Story', 'Illustration resume started', { storyId, startPage: result.startPage, message: result.message })
  storeDeployInfo(storyId, {
    functionVersion: result.functionVersion ?? null,
    hasOpenAiKey: result.hasOpenAiKey ?? null,
  })
  return { data: result, error: null }
}

export async function illustrateNextBatch(storyId) {
  log('Story', 'Triggering manual illustration batch', { storyId })

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    logError('Story', 'No active session for manual illustration')
    return { data: null, error: { message: 'Please sign in again.' } }
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-story`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ storyId, mode: 'illustrate_next_batch' }),
    }
  )

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    logError('Story', 'Manual illustration batch rejected', {
      storyId,
      status: response.status,
      error: result.error,
    })
    return { data: null, error: { message: result.error || 'Could not start illustration batch.' } }
  }

  log('Story', 'Manual illustration batch started', { storyId, message: result.message })
  return { data: result, error: null }
}

const STORY_PROGRESS_SELECT_FULL = `
  id, status, title, child_id, pages_completed, error_message, story_metadata,
  pages (page_number, image_url)
`

const STORY_PROGRESS_SELECT_BASE = `
  id, status, title, child_id, error_message,
  pages (page_number, image_url)
`

/** How long without progress before we treat generation as stalled (ms). */
export const GENERATION_STALL_LIMITS = {
  pending: 90_000,
  writing: 8 * 60_000,
  preparing: 6 * 60_000,
  illustrating: 10 * 60_000,
  /** Trigger auto-resume when illustration count unchanged this long (ms). */
  autoResumeIllustrating: 5 * 60_000,
  readyNotSet: 4 * 60_000,
  maxTotal: 60 * 60_000,
}

export const MAX_POLL_FAILURES = 5

export function computeIllustrationProgress(pages = []) {
  const pagesInDb = pages.length
  const illustratedCount = pages.filter((p) => !isPlaceholderImage(p.image_url)).length
  return { pagesInDb, illustratedCount }
}

export function createGenerationProgressTracker() {
  return {
    fingerprint: null,
    lastChangeAt: Date.now(),
    startedAt: Date.now(),
  }
}

function progressFingerprint(snapshot) {
  return [
    snapshot.status,
    snapshot.title ?? '',
    snapshot.pagesCompletedCol,
    snapshot.pagesInDb,
    snapshot.illustratedCount,
  ].join('|')
}

/** Update tracker; returns staleMs since last meaningful progress. */
export function touchGenerationProgressTracker(tracker, snapshot) {
  const fp = progressFingerprint(snapshot)
  const changed = tracker.fingerprint !== fp
  if (changed) {
    tracker.fingerprint = fp
    tracker.lastChangeAt = Date.now()
  }
  const now = Date.now()
  return {
    staleMs: now - tracker.lastChangeAt,
    elapsedMs: now - tracker.startedAt,
    changed,
  }
}

/**
 * Returns whether generation appears healthy, or a stall diagnosis if not.
 * Call after each poll with a snapshot from getStoryProgress.
 */
export function evaluateGenerationHealth(snapshot, { staleMs, elapsedMs }, illustrationTarget = STORY_PAGE_COUNT) {
  const { status, title, pagesCompletedCol, pagesInDb, illustratedCount } = snapshot
  const target = Math.max(1, illustrationTarget)

  if (elapsedMs >= GENERATION_STALL_LIMITS.maxTotal) {
    return {
      healthy: false,
      code: 'max_duration',
      message: `Generation exceeded ${Math.round(GENERATION_STALL_LIMITS.maxTotal / 60000)} minutes without finishing.`,
    }
  }

  if (status === 'pending') {
    if (staleMs >= GENERATION_STALL_LIMITS.pending) {
      return {
        healthy: false,
        code: 'pending_timeout',
        message: 'The story never left "pending" — the edge function likely never started. Check the browser console and Supabase Edge Function logs for generate-story.',
      }
    }
    return { healthy: true }
  }

  if (status === 'generating') {
    if (!title && pagesInDb === 0 && staleMs >= GENERATION_STALL_LIMITS.writing) {
      return {
        healthy: false,
        code: 'writing_stalled',
        message: 'Story writing appears stuck (no title or pages saved). Check OPENAI_API_KEY, billing, and generate-story logs.',
      }
    }

    if (title && pagesInDb === 0 && staleMs >= GENERATION_STALL_LIMITS.preparing) {
      return {
        healthy: false,
        code: 'preparing_stalled',
        message: 'Story text was saved but illustrations never started. Check migration_phase4.sql (storage bucket) and edge function logs.',
      }
    }

    if (pagesInDb > 0 && illustratedCount < target && staleMs >= GENERATION_STALL_LIMITS.illustrating) {
      return {
        healthy: false,
        code: 'illustrating_stalled',
        message: `Illustration progress stalled at ${illustratedCount} of ${target} images. The edge function may have timed out — check Supabase logs.`,
      }
    }

    if (
      illustratedCount >= target
      && status === 'generating'
      && staleMs >= GENERATION_STALL_LIMITS.readyNotSet
    ) {
      return {
        healthy: false,
        code: 'ready_not_set',
        message: `All ${illustratedCount} illustrations finished but the story was not marked ready. Check edge function logs.`,
      }
    }

    return { healthy: true }
  }

  return { healthy: true }
}

export function getStallDiagnostics(storyId, snapshot, { staleMs, elapsedMs }, health) {
  return {
    storyId,
    status: snapshot.status,
    title: snapshot.title,
    pagesCompletedCol: snapshot.pagesCompletedCol,
    pagesInDb: snapshot.pagesInDb,
    illustratedCount: snapshot.illustratedCount,
    staleSec: Math.round(staleMs / 1000),
    elapsedMin: Math.round(elapsedMs / 60000),
    stallCode: health.code,
    stallMessage: health.message,
  }
}

export function storeDeployInfo(storyId, info) {
  try {
    sessionStorage.setItem(`story-deploy-${storyId}`, JSON.stringify(info))
  } catch {
    // ignore
  }
}

export function getStoredDeployInfo(storyId) {
  try {
    const raw = sessionStorage.getItem(`story-deploy-${storyId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Live check — not the version cached when the story was first created. */
export async function fetchEdgeFunctionVersion() {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-story`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ mode: 'version' }),
      },
    )
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return { data: null, error: body.error || 'Could not reach edge function' }
    return {
      data: {
        functionVersion: body.functionVersion ?? null,
        hasOpenAiKey: body.hasOpenAiKey ?? null,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err.message }
  }
}

export function getDeployWarningMessage(deployInfo) {
  if (!deployInfo) return null
  if (deployInfo.hasOpenAiKey === false) {
    return 'OPENAI_API_KEY is not set on the edge function.'
  }
  if (deployInfo.functionVersion && deployInfo.functionVersion !== EXPECTED_FUNCTION_VERSION) {
    return `Edge function is ${deployInfo.functionVersion} — deploy generate-story (${EXPECTED_FUNCTION_VERSION}) for the latest illustration fixes.`
  }
  return null
}

export function inferGenerationErrorHint({ errorMessage, pagesCompleted, storyTitle, deployInfo }) {
  if (errorMessage) return errorMessage

  const hints = []
  const version = deployInfo?.functionVersion
  if (!version || version !== EXPECTED_FUNCTION_VERSION) {
    hints.push(`Edge function not up to date (deployed: ${version ?? 'unknown'}). Run: supabase functions deploy generate-story`)
  }
  if (deployInfo?.hasOpenAiKey === false) {
    hints.push('OPENAI_API_KEY is not set in Supabase Edge Function secrets.')
  }
  if (pagesCompleted > 0) {
    hints.push(`${pagesCompleted} illustration(s) saved — use "Resume illustrations" to continue from where it stopped.`)
  } else if (storyTitle) {
    hints.push('Story text was written but illustration generation failed. Check OpenAI billing, GPT Image access, migration_phase4.sql (storage bucket), and Edge Function logs.')
  } else {
    hints.push('Failed before any pages were saved — likely during story writing. Check OPENAI_API_KEY, billing, and Edge Function logs.')
  }
  hints.push('If illustrations stall, deploy the latest generate-story edge function, then tap Resume illustrations.')
  return hints.join(' ')
}

/** Short label for bookshelf / cards when status is error. */
export function formatStoryFailureSummary(story, illustrationTarget = STORY_PAGE_COUNT) {
  const { illustratedCount } = computeIllustrationProgress(story.pages ?? [])
  const illustrated = illustratedCount > 0
    ? `${illustratedCount} of ${illustrationTarget} illustrated — `
    : ''
  const reason = story.error_message?.trim() || 'Unknown error (check Supabase generate-story logs)'
  return `${illustrated}${reason}`
}

function isMissingColumnError(error) {
  const msg = error?.message?.toLowerCase() ?? ''
  return msg.includes('pages_completed') || msg.includes('error_message') || msg.includes('story_metadata') || msg.includes('column')
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

  const pages = data.pages ?? []
  const { pagesInDb, illustratedCount } = computeIllustrationProgress(pages)
  const pagesCompletedCol = data.pages_completed ?? 0

  return {
    data: {
      id: data.id,
      status: data.status,
      title: data.title,
      childId: data.child_id,
      errorMessage: data.error_message ?? null,
      storyMetadata: data.story_metadata ?? null,
      pagesCompletedCol,
      pagesInDb,
      illustratedCount,
      /** Best estimate of illustration progress (not seeded placeholder rows). */
      pagesCompleted: illustratedCount > 0 ? illustratedCount : pagesCompletedCol,
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

export async function deleteStory(storyId) {
  log('Story', 'Deleting story', { storyId })

  const { error } = await supabase
    .from('stories')
    .delete()
    .eq('id', storyId)

  if (error) {
    logError('Story', 'Failed to delete story', { storyId, message: error.message })
    const message = error.message?.includes('policy')
      ? 'You do not have permission to delete this story. Run migration_phase5.sql in Supabase.'
      : error.message
    return { error: { ...error, message } }
  }

  log('Story', 'Story deleted', { storyId })
  return { error: null }
}

export async function getStoriesForChild(childId) {
  const { data, error } = await supabase
    .from('stories')
    .select(`
      id, title, status, created_at, pages_completed, error_message,
      pages (image_url, page_number)
    `)
    .eq('child_id', childId)
    .in('status', ['pending', 'generating', 'ready', 'error'])
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
      id, title, status, created_at, child_id, error_message, story_metadata,
      pages (id, page_number, text_content, image_url)
    `)
    .eq('id', storyId)
    .single()

  if (data?.pages) {
    data.pages.sort((a, b) => a.page_number - b.page_number)
  }

  return { data, error }
}

/** User-input phrase introduced on this page (from story_metadata plotPoints). */
export function getUserInputIntroForPage(metadata, pageNumber) {
  if (!metadata?.plotPoints || !pageNumber) return null
  const point = metadata.plotPoints.find(
    (p) => p.type === 'user_input' && p.page === pageNumber && p.userInput,
  )
  return point?.userInput ?? null
}

/** Split page text into plain and highlight segments for a phrase. */
export function splitTextAroundPhrase(text, phrase) {
  if (!text || !phrase) return [{ type: 'text', value: text ?? '' }]

  const lower = text.toLowerCase()
  const needle = phrase.toLowerCase()
  const idx = lower.indexOf(needle)
  if (idx === -1) return [{ type: 'text', value: text }]

  const segments = []
  if (idx > 0) segments.push({ type: 'text', value: text.slice(0, idx) })
  segments.push({ type: 'highlight', value: text.slice(idx, idx + phrase.length) })
  if (idx + phrase.length < text.length) {
    segments.push({ type: 'text', value: text.slice(idx + phrase.length) })
  }
  return segments
}
