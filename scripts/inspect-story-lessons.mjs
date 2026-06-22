import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const storyId = process.argv[2]
if (!storyId) {
  console.error('Usage: node scripts/inspect-story-lessons.mjs <story-id>')
  process.exit(1)
}

function loadEnv() {
  const env = {}
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    env[line.slice(0, i)] = line.slice(i + 1)
  }
  return env
}

const CRITIC_LESSONS_RATING_THRESHOLD = 80

const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const { data: story, error } = await sb
  .from('stories')
  .select('id, title, status, child_id, created_at, story_metadata, children(name, birthday)')
  .eq('id', storyId)
  .single()

if (error) {
  console.error('Could not load story:', error.message)
  console.error('(RLS may block anon access — run the SQL query in Supabase instead.)')
  process.exit(1)
}

const applied = story.story_metadata?.appliedPriorLessons
if (applied) {
  console.log('\n=== appliedPriorLessons (stored on THIS story) ===')
  console.log(JSON.stringify(applied, null, 2))
}

const critic = story.story_metadata?.criticFeedback
console.log('=== Story ===')
console.log(JSON.stringify({
  id: story.id,
  title: story.title,
  status: story.status,
  child_id: story.child_id,
  created_at: story.created_at,
}, null, 2))

if (!critic) {
  console.log('\nNo criticFeedback in story_metadata.')
  process.exit(0)
}

console.log('\n=== Raw criticFeedback ===')
console.log(JSON.stringify(critic, null, 2))

const weakRating = critic.rating < CRITIC_LESSONS_RATING_THRESHOLD
const awkwardInputs = critic.inputsFitNaturally === 'items_feel_out_of_place'
console.log('\n=== Would feed next story? ===')
console.log({ rating: critic.rating, weakRating, awkwardInputs, included: weakRating || awkwardInputs })

if (!weakRating && !awkwardInputs) {
  console.log('\nThis story would NOT be used in the feedback loop (rating >= 80 and inputs OK).')
  process.exit(0)
}

const childName = story.children?.name ?? 'the child'
let childAge = 5
if (story.children?.birthday) {
  const birth = new Date(story.children.birthday)
  const today = new Date()
  childAge = today.getFullYear() - birth.getFullYear()
}

const rawBlock = [
  `Story 1 "${story.title}" (critic ${critic.rating}/100)`,
  critic.faults ? `Faults: ${critic.faults}` : '',
  critic.improvements ? `Improvements: ${critic.improvements}` : '',
  awkwardInputs ? 'Child answers felt forced or out of place.' : '',
].filter(Boolean).join('\n')

const openaiKey = env.OPENAI_API_KEY
if (!openaiKey) {
  console.log('\nNo OPENAI_API_KEY — cannot run generalization. Raw notes above would be sent to GPT.')
  process.exit(0)
}

console.log('\n=== Running generalization (same as edge function) ===')

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${openaiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You distill children's story editor notes into general writing rules for the NEXT story for a ${childAge}-year-old reader.

Past notes mention specific plots, character names, story titles, and child answers — strip ALL of that out.

Return ONLY JSON: { "lessons": ["rule 1", "rule 2"] }

Output rules:
- 2 to 4 short, actionable lessons
- Each lesson must apply to ANY new story with completely different child answers
- NEVER mention character names, story titles, or specific child answers from the past
- Focus on: plot structure, weaving answers naturally, pacing, conflict, avoiding filler, read-aloud quality
- Write in imperative voice ("Include...", "Avoid...", "Weave...")`,
      },
      {
        role: 'user',
        content: `Past editor notes to generalize:\n\n${rawBlock}`,
      },
    ],
    response_format: { type: 'json_object' },
  }),
})

const body = await response.json()
if (!response.ok) {
  console.error('OpenAI error:', body?.error?.message ?? response.status)
  process.exit(1)
}

const lessons = JSON.parse(body.choices[0].message.content).lessons ?? []
console.log('\n=== Generalized lessons (injected into next story prompt) ===')
lessons.forEach((lesson, i) => console.log(`${i + 1}. ${lesson}`))
