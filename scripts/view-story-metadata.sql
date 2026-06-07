-- View story metadata in Supabase
-- 1. Open Supabase Dashboard → SQL Editor → New query
-- 2. Paste this file (or the query you need below)
-- 3. Replace the story ID if needed, then Run

-- ---------------------------------------------------------------------------
-- Single story (pretty-printed JSON)
-- ---------------------------------------------------------------------------
SELECT
  id,
  title,
  status,
  pages_completed,
  created_at,
  jsonb_pretty(inputs) AS inputs,
  jsonb_pretty(story_metadata) AS story_metadata
FROM stories
WHERE id = '4d5c0df2-f2a3-4a37-9026-034c9ca8b163';


-- ---------------------------------------------------------------------------
-- Optional: recent stories (pick an id, then use the query above)
-- Uncomment to run instead of the single-story query.
-- ---------------------------------------------------------------------------
-- SELECT
--   id,
--   title,
--   status,
--   pages_completed,
--   created_at,
--   story_metadata IS NOT NULL AS has_metadata
-- FROM stories
-- ORDER BY created_at DESC
-- LIMIT 20;


-- ---------------------------------------------------------------------------
-- Optional: just the user inputs from metadata
-- Works for userInputs (new) or sourceInputs (older stories)
-- ---------------------------------------------------------------------------
-- SELECT
--   id,
--   title,
--   COALESCE(
--     story_metadata -> 'userInputs',
--     story_metadata -> 'sourceInputs'
--   ) AS user_inputs
-- FROM stories
-- WHERE id = '4d5c0df2-f2a3-4a37-9026-034c9ca8b163';
