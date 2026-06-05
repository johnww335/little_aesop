const PREFIX = '[Little Aesop]'

function format(stage, message, data) {
  const label = `${PREFIX} [${stage}] ${message}`
  return data !== undefined ? [label, data] : [label]
}

export function log(stage, message, data) {
  console.log(...format(stage, message, data))
}

export function warn(stage, message, data) {
  console.warn(...format(stage, message, data))
}

export function error(stage, message, data) {
  console.error(...format(stage, message, data))
}

/** placehold.co tiles saved when dev mode is on or image generation failed. */
export function isPlaceholderImage(url) {
  return typeof url === 'string' && url.includes('placehold.co')
}

export function logImageDiagnostics(storyId, pages) {
  if (!pages?.length) return
  const placeholderCount = pages.filter((p) => isPlaceholderImage(p.image_url)).length
  const sampleUrl = pages[0]?.image_url ?? '(none)'
  if (placeholderCount === pages.length) {
    warn('Images', '⚠️  All pages use placeholder images — not GPT Image', {
      storyId,
      pageCount: pages.length,
      sampleUrl,
      hint: 'Restart npm run dev after setting VITE_DEV_STORY_MODE=false, then generate a NEW story. Check Supabase generate-story logs for "Dev mode: using placeholder images".',
    })
  } else if (placeholderCount > 0) {
    warn('Images', '⚠️  Some pages use placeholder images', {
      storyId,
      placeholderCount,
      total: pages.length,
      sampleUrl,
    })
  } else {
    log('Images', '✓ Real GPT Image illustrations', { storyId, pageCount: pages.length, sampleUrl })
  }
}

/** Detect the dev placeholder template (not GPT output). */
export function looksLikeTemplateStory(pages) {
  if (!pages?.length) return false
  const markers = [
    /Everyone agreed that .+ made the day even more memorable/i,
    /turned out to be the surprise that changed everything/i,
    /Without .+, the adventure might never have happened/i,
    /^Once upon a time, a brave explorer set off toward the /i,
  ]
  const hits = markers.filter((re) => pages.some((p) => re.test(p))).length
  return hits >= 2
}

/** TEMP: remove before production — dumps full story text for manual QA */
export function logStoryText(storyId, { title, pages, meta }) {
  console.log(`${PREFIX} [Debug] ========== FULL STORY TEXT ==========`)
  console.log(`${PREFIX} [Debug] Story ID:`, storyId)
  const isTemplate = meta?.usedFallback || looksLikeTemplateStory(pages)
  if (isTemplate) {
    console.warn(`${PREFIX} [Debug] ⚠️  PLACEHOLDER TEMPLATE — not a GPT story.`, meta?.fallbackReason ?? 'Set OPENAI_API_KEY in Supabase Edge Function secrets and redeploy generate-story.')
  } else if (meta) {
    console.log(`${PREFIX} [Debug] Pages from OpenAI:`, `${meta.originalPageCount} / ${pages.length}`)
    if (meta.reviewPassed) console.log(`${PREFIX} [Debug] ✓ Passed quality review (attempt ${meta.reviewAttempts})`)
    if (meta.reviewSkipped) console.warn(`${PREFIX} [Debug] ⚠️  Quality review skipped`)
    if (meta.reviewFeedback) console.warn(`${PREFIX} [Debug] Review notes:`, meta.reviewFeedback)
    if (meta.wasPadded) console.warn(`${PREFIX} [Debug] ⚠️  Pages were padded — story may feel repetitive at the end`)
    if (meta.retried) console.warn(`${PREFIX} [Debug] ⚠️  Generation was retried due to low page count`)
  }
  console.log(`${PREFIX} [Debug] Title:`, title)
  pages.forEach((page, i) => {
    console.log(`${PREFIX} [Debug] Page ${i + 1}:`, page)
  })
  console.log(`${PREFIX} [Debug] =====================================`)
}
