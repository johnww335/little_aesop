-- ============================================================
-- Little Aesop — Phase 4 Migration
-- Storage bucket for GPT Image illustrations (replaces DALL-E URLs)
-- Run in Supabase SQL editor after migration_phase3.sql
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-images',
  'story-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can view story illustrations (public bucket)
create policy "Public read story images"
  on storage.objects for select
  using (bucket_id = 'story-images');
