/**
 * Practice GPT Image illustration generation locally (same style as generate-story).
 * Usage:
 *   npm run practice-images
 *   npm run practice-images -- "A brave explorer climbs snowy mountains at sunrise"
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUTPUT_DIR = resolve(ROOT, 'practice-output')

const STYLE_PROMPT =
  'minimal hand-drawn cartoon illustration, loose sketchy pencil and ink linework, simple shapes, soft muted colors, gentle watercolor wash, uncluttered composition with plenty of empty space, friendly expressive characters, warm children\'s storybook aesthetic, no text, no words, no letters'

const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-1.5'
const MAX_RETRIES = 2

const DEFAULT_SCENES = [
  'A brave young explorer stands at the foot of tall snowy mountains, backpack ready and eyes full of wonder.',
  'Inside a cozy kitchen, the explorer opens a humming freezer and discovers a glowing map frozen in ice.',
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

function slugify(text, maxLen = 40) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
  return slug || 'scene'
}

async function generateImage(scenePrompt, openaiKey, pageIndex, retries = 0) {
  console.log(`\n--- Generating image ${pageIndex + 1} (${IMAGE_MODEL}) ---`)
  console.log(`Scene: ${scenePrompt}`)

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: `${STYLE_PROMPT}. Scene: ${scenePrompt}`,
      n: 1,
      size: '1024x1024',
      quality: 'medium',
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    const message = data?.error?.message || `Image API error (${response.status})`
    if (retries < MAX_RETRIES) {
      console.log(`Retrying (${retries + 1}/${MAX_RETRIES})… ${message}`)
      await new Promise((r) => setTimeout(r, 1000 * (retries + 1)))
      return generateImage(scenePrompt, openaiKey, pageIndex, retries + 1)
    }
    throw new Error(message)
  }

  const b64 = data.data?.[0]?.b64_json
  const url = data.data?.[0]?.url
  if (b64) return { b64, url: null }
  if (url) return { b64: null, url }
  throw new Error('OpenAI returned no image data')
}

async function saveImage(result, filename) {
  const filepath = resolve(OUTPUT_DIR, filename)
  if (result.b64) {
    writeFileSync(filepath, Buffer.from(result.b64, 'base64'))
    return filepath
  }
  const response = await fetch(result.url)
  if (!response.ok) throw new Error(`Failed to download image (${response.status})`)
  writeFileSync(filepath, Buffer.from(await response.arrayBuffer()))
  return filepath
}

async function main() {
  loadEnvFile()

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey || openaiKey === 'your-openai-key-here') {
    console.error('\nMissing OPENAI_API_KEY.')
    console.error('Add it to .env or run: OPENAI_API_KEY=sk-... npm run practice-images\n')
    process.exit(1)
  }

  const cliScenes = process.argv.slice(2)
  const scenes = cliScenes.length > 0 ? cliScenes : DEFAULT_SCENES

  mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log(`Practicing ${scenes.length} illustration(s) (${IMAGE_MODEL}, 1024×1024)`)
  console.log(`Output folder: ${OUTPUT_DIR}`)
  console.log('Note: DALL-E 3 was retired May 2026 — this uses GPT Image models.')

  for (let i = 0; i < scenes.length; i++) {
    const started = Date.now()
    const result = await generateImage(scenes[i], openaiKey, i)
    const filename = `page-${i + 1}-${slugify(scenes[i])}.png`
    const filepath = await saveImage(result, filename)
    console.log(`✓ Saved: ${filepath} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  }

  console.log('\nOpen the PNGs in practice-output/ to preview the illustration style.\n')
}

main().catch((err) => {
  console.error('\nPractice run failed:', err.message)
  process.exit(1)
})
