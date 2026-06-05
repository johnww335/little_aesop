-- ============================================================
-- Little Aesop — Phase 1 Database Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- CHILDREN
-- Stores child profiles linked to a parent (auth.users)
-- ============================================================
create table if not exists public.children (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 50),
  birthday    date not null,
  gender      text check (gender in ('boy', 'girl', 'other', '') or gender is null),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Index for fast lookup of children by parent
create index if not exists children_user_id_idx on public.children(user_id);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger children_updated_at
  before update on public.children
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Parents can only see and modify their own children
-- ============================================================
alter table public.children enable row level security;

-- Select: parent can read their own children
create policy "Parents can view their own children"
  on public.children for select
  using (auth.uid() = user_id);

-- Insert: parent can add children (enforced in app to max 10)
create policy "Parents can insert their own children"
  on public.children for insert
  with check (auth.uid() = user_id);

-- Update: parent can update their own children
create policy "Parents can update their own children"
  on public.children for update
  using (auth.uid() = user_id);

-- Delete: parent can delete their own children
create policy "Parents can delete their own children"
  on public.children for delete
  using (auth.uid() = user_id);

-- ============================================================
-- QUESTION BANK
-- Populated in Phase 2. Schema added here for completeness.
-- ============================================================
create table if not exists public.question_bank (
  id           uuid primary key default gen_random_uuid(),
  prompt_text  text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Anyone authenticated can read questions (no RLS needed — questions are public)
alter table public.question_bank enable row level security;

create policy "Authenticated users can read questions"
  on public.question_bank for select
  to authenticated
  using (active = true);

-- ============================================================
-- STORIES (stub — fully built in Phase 2)
-- ============================================================
create table if not exists public.stories (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid not null references public.children(id) on delete cascade,
  title       text,
  status      text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'error')),
  inputs      jsonb,           -- the 5 question/answer pairs
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stories_child_id_idx on public.stories(child_id);

create trigger stories_updated_at
  before update on public.stories
  for each row execute function public.set_updated_at();

alter table public.stories enable row level security;

-- Parents can access stories belonging to their children
create policy "Parents can view their children's stories"
  on public.stories for select
  using (
    exists (
      select 1 from public.children
      where children.id = stories.child_id
        and children.user_id = auth.uid()
    )
  );

create policy "Parents can insert stories for their children"
  on public.stories for insert
  with check (
    exists (
      select 1 from public.children
      where children.id = stories.child_id
        and children.user_id = auth.uid()
    )
  );

create policy "Parents can update their children's stories"
  on public.stories for update
  using (
    exists (
      select 1 from public.children
      where children.id = stories.child_id
        and children.user_id = auth.uid()
    )
  );

-- ============================================================
-- PAGES (stub — fully built in Phase 2)
-- ============================================================
create table if not exists public.pages (
  id           uuid primary key default gen_random_uuid(),
  story_id     uuid not null references public.stories(id) on delete cascade,
  page_number  integer not null,
  text_content text,
  image_url    text,
  created_at   timestamptz not null default now(),
  unique (story_id, page_number)
);

create index if not exists pages_story_id_idx on public.pages(story_id);

alter table public.pages enable row level security;

create policy "Parents can view pages for their children's stories"
  on public.pages for select
  using (
    exists (
      select 1 from public.stories
      join public.children on children.id = stories.child_id
      where stories.id = pages.story_id
        and children.user_id = auth.uid()
    )
  );
