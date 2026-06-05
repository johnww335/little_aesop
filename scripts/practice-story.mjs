/**
 * Practice story generation locally using the same prompts as generate-story.
 * Usage:
 *   OPENAI_API_KEY=sk-... npm run practice-story
 *   npm run practice-story -- mountains freezer trumpet shrimp bed
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const PAGE_COUNT = 20
const MAX_QUALITY_ATTEMPTS = 3

const DEFAULT_INPUTS = [
  { question: 'Where would you like to explore?', answer: 'mountains' },
  { question: 'What is the strangest thing in your kitchen?', answer: 'freezer' },
  { question: 'Name a musical instrument', answer: 'trumpet' },
  { question: 'What is your favourite sea creature?', answer: 'shrimp' },
  { question: 'What is the comfiest thing?', answer: 'bed' },
]

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(ROOT, '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // no .env
  }
}

function formatStoryBrief(inputs) {
  return inputs
    .map((i, n) => `${n + 1}. "${i.answer}" (child was thinking about: ${i.question})`)
    .join('\n')
}

function ageWritingGuide(age) {
  if (age <= 3) return 'Use very simple words, short sentences, and gentle repetition.'
  if (age <= 6) return 'Use simple sentences, playful tone, and concrete imagery.'
  if (age <= 9) return 'Use clear plots, light humour, and slightly richer vocabulary.'
  return 'Use engaging plots with warmth and humour appropriate for a pre-teen.'
}

function buildSystemPrompt(context) {
  return `You are a children's book author writing for ${context.childName}, who is ${context.childAge} years old.
${ageWritingGuide(context.childAge)}
Rules:
- Write exactly ${PAGE_COUNT} pages (one paragraph per page)
- Each page should be 1-2 short sentences
- Create a coherent PLOT: a beginning that sets up a goal or problem, a middle where events unfold, and a satisfying ending
- Weave each child ANSWER below into the plot as story events — the answers are ingredients, not dialogue to recite
- NEVER quote or mention the original prompt questions in the story text
- NEVER write Q&A style lines like 'They wondered: "..."' or '"mouse!" they shouted'
- The story must read like a normal published children's book — answers appear naturally (a mouse in a scene, Mars as a destination, etc.)
- NEVER write filler like "Everyone agreed that X made the day memorable" or "X turned out to be the surprise"
- Each answer should inspire a concrete scene, action, character, place, or object — not be pasted as a bare noun
- Example for answers mouse, Mars, trumpet: GOOD: "A tiny mouse scampered over the giant's boot." BAD: "The path led toward mouse."
- Pages must be unique — do NOT repeat sentences across pages
- Make it fun, warm, and engaging for a ${context.childAge}-year-old
- Structure: beginning (pages 1-5), middle (pages 6-15), end (pages 16-20)
- Return ONLY JSON: { "title": "Story Title", "pages": ["page 1", "page 2", ...] }
- The pages array must contain exactly ${PAGE_COUNT} strings`
}

async function chatJson(openaiKey, messages, maxTokens = 4096) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages,
      response_format: { type: 'json_object' },
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI error (${response.status})`)
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI returned no content')
  return JSON.parse(content)
}

async function generateStoryText(inputs, openaiKey, context) {
  const storyBrief = formatStoryBrief(inputs)
  const revisionNote = context.revisionFeedback
    ? `\n\nFix these issues from the previous draft:\n${context.revisionFeedback}`
    : ''

  console.log('\n--- Generating story text ---')
  const story = await chatJson(openaiKey, [
    { role: 'system', content: buildSystemPrompt(context) },
    {
      role: 'user',
      content: `Write a children's story weaving ALL of these answers into the plot naturally. Use only the answers in the story — never the questions:\n${storyBrief}${revisionNote}`,
    },
  ])

  if (!Array.isArray(story.pages)) throw new Error('Invalid story format')
  story.pages = story.pages.slice(0, PAGE_COUNT)
  return { title: story.title || 'Your Story', pages: story.pages }
}

async function reviewStory(story, inputs, context, openaiKey) {
  const storyText = story.pages.map((page, i) => `Page ${i + 1}: ${page}`).join('\n')
  const answerList = inputs.map((i) => i.answer).join(', ')
  const questionSnippets = inputs.map((i) => i.question)

  console.log('--- Running quality review ---')

  const review = await chatJson(
    openaiKey,
    [
      {
        role: 'system',
        content: `You are a children's book editor reviewing a story for a ${context.childAge}-year-old reader named ${context.childName}.
Evaluate the draft against these three criteria:
1. hasPlot — the story has a clear narrative arc (setup, events, resolution), not just a list of mentions
2. isFunForAge — the tone, vocabulary, and humour are engaging and appropriate for age ${context.childAge}
3. usesInputsInPlot — each child answer (${answerList}) appears in the story AND drives part of the plot
4. feelsNatural — reads like a real picture book; prompt questions are NOT quoted; no forced Q&A recitation of answers

Return ONLY JSON:
{
  "passes": true,
  "hasPlot": true,
  "isFunForAge": true,
  "usesInputsInPlot": true,
  "feelsNatural": true,
  "feedback": "brief editor notes if anything needs fixing",
  "missingInputs": ["answers that are missing or not part of the plot"]
}
Set passes to true only if ALL four criteria are met. Fail feelsNatural if any prompt question appears in the story or answers feel pasted in. Be constructive but firm in feedback when passes is false.`,
      },
      {
        role: 'user',
        content: `Answers that must appear naturally in the plot: ${answerList}\nPrompt questions (must NOT appear in story text): ${questionSnippets.join(' | ')}\n\nStory draft:\nTitle: ${story.title}\n${storyText}`,
      },
    ],
    500,
  )

  review.passes = Boolean(
    review.hasPlot && review.isFunForAge && review.usesInputsInPlot && review.feelsNatural,
  )
  review.missingInputs = review.missingInputs ?? []
  review.feedback = review.feedback ?? ''
  return review
}

function printStory(story, review, attempt) {
  console.log(`\n========== STORY (attempt ${attempt}) ==========`)
  console.log(`Title: ${story.title}`)
  story.pages.forEach((page, i) => console.log(`Page ${i + 1}: ${page}`))
  console.log('================================================')
  if (review) {
    console.log('\nReview:', {
      passes: review.passes,
      hasPlot: review.hasPlot,
      isFunForAge: review.isFunForAge,
      usesInputsInPlot: review.usesInputsInPlot,
      feelsNatural: review.feelsNatural,
      missingInputs: review.missingInputs,
      feedback: review.feedback,
    })
  }
}

function parseCliInputs(argv) {
  if (argv.length === 0) return DEFAULT_INPUTS
  return argv.map((answer, i) => ({
    question: `Prompt ${i + 1}`,
    answer,
  }))
}

async function main() {
  loadEnvFile()

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey || openaiKey === 'your-openai-key-here') {
    console.error('\nMissing OPENAI_API_KEY.')
    console.error('Add it to .env or run: OPENAI_API_KEY=sk-... npm run practice-story\n')
    process.exit(1)
  }

  const cliAnswers = process.argv.slice(2)
  const inputs = parseCliInputs(cliAnswers)
  const context = { childName: 'Alex', childAge: 6, revisionFeedback: undefined }

  console.log('Practicing with inputs:')
  inputs.forEach((i) => console.log(`  • "${i.answer}" (${i.question})`))

  let revisionFeedback = context.revisionFeedback
  let lastReview = null
  let lastStory = null

  for (let attempt = 1; attempt <= MAX_QUALITY_ATTEMPTS; attempt++) {
    const story = await generateStoryText(inputs, openaiKey, { ...context, revisionFeedback })
    const review = await reviewStory(story, inputs, context, openaiKey)
    lastReview = review
    lastStory = story
    printStory(story, review, attempt)

    if (review.passes) {
      console.log('\n✓ Story passed quality review')
      return
    }

    revisionFeedback = [
      review.feedback,
      !review.hasPlot ? 'Add a clearer plot with a beginning, middle, and end.' : '',
      !review.isFunForAge ? `Make it more fun and age-appropriate for a ${context.childAge}-year-old.` : '',
      !review.usesInputsInPlot
        ? `Weave these answers into the plot as events: ${review.missingInputs.join(', ') || inputs.map((i) => i.answer).join(', ')}.`
        : '',
      !review.feelsNatural
        ? 'Rewrite so answers appear naturally in the narrative. Do not quote the original questions or recite answers in a Q&A style.'
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    console.log(`\n↻ Regenerating (${attempt}/${MAX_QUALITY_ATTEMPTS})…`)
    console.log(`Revision notes: ${revisionFeedback}\n`)
  }

  console.error(`\n✗ Did not pass review after ${MAX_QUALITY_ATTEMPTS} attempts`)
  if (lastReview?.feedback) console.error(`Last feedback: ${lastReview.feedback}`)
  if (lastStory) console.log('\n(Last draft printed above — tweak prompts and run again)')
  process.exit(1)
}

main().catch((err) => {
  console.error('\nPractice run failed:', err.message)
  process.exit(1)
})
