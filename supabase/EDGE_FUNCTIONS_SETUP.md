# Little Aesop — Supabase Edge Functions Setup

## Prerequisites
- Supabase CLI installed: `npm install -g supabase`
- Logged in: `supabase login`
- Project linked: `supabase link --project-ref medlqornlszbbrgbubqr`

Your project ref is the ID in your Supabase project URL:
`https://supabase.com/dashboard/project/YOUR_PROJECT_REF`

---

## 1. Set secrets (environment variables for Edge Functions)

```bash
supabase secrets set OPENAI_API_KEY=sk-your-openai-key-here
```

The `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available
inside Edge Functions — you do NOT need to set those manually.

---

## 2. Deploy the Edge Functions

```bash
supabase functions deploy validate-inputs
supabase functions deploy generate-story
```

---

## 3. Background tasks (no dashboard toggle)

The `generate-story` function uses `EdgeRuntime.waitUntil()` so the HTTP response returns immediately while generation continues. **There is nothing to enable in Project Settings** — this is built into Supabase Edge Functions.

Wall-clock limits for the background work:

| Plan | Max duration |
|------|----------------|
| Free | **150 seconds** (~2.5 min) |
| Paid | **400 seconds** (~6.5 min) |

Generating **20 DALL-E illustrations** often takes **10–25 minutes**, which exceeds these limits. That is why stories fail or stall at 0 pages.

**Development:** keep `VITE_DEV_STORY_MODE=true` in `.env` for fast placeholder images while testing story text.

**Production options (later):** split image generation across multiple function invocations, a job queue, or fewer pages per story.

**Style testing now:** set in `.env`:

```
VITE_DEV_STORY_MODE=false
VITE_DALLE_PAGE_LIMIT=3
```

Pages 1–3 get real GPT Image illustrations; pages 4–20 use placeholders. Fits within Edge Function time limits (~2–3 min for 3 images + story text). Redeploy `generate-story` after changing limits.

**Important:** OpenAI retired DALL-E 3 in May 2026. This project uses **`gpt-image-1.5`** and stores images in Supabase Storage. Run `migration_phase4.sql` to create the `story-images` bucket.

---

## 4. Verify deployment

In your Supabase dashboard, go to **Edge Functions** and confirm both functions
appear as deployed. You can test them from the dashboard or via curl.

---

## 5. Update .env

Make sure your `.env` has:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

The frontend uses these to call the Edge Functions.
