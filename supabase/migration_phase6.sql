-- ============================================================
-- Little Aesop — Phase 6 Migration
-- Story architecture metadata (characters, plot, critic feedback)
-- Run in Supabase SQL editor after migration_phase5.sql
-- ============================================================

alter table public.stories
  add column if not exists story_metadata jsonb;
