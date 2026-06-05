-- ============================================================
-- Little Aesop — Phase 3 Migration
-- Tracks illustration progress on in-flight stories
-- Run in Supabase SQL editor after migration_phase2.sql
-- ============================================================

alter table public.stories
  add column if not exists pages_completed smallint not null default 0;

alter table public.stories
  add column if not exists error_message text;
