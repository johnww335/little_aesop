-- ============================================================
-- Little Aesop — Phase 5 Migration
-- Allow parents to delete their children's stories
-- Run in Supabase SQL editor after prior migrations
-- ============================================================

create policy "Parents can delete their children's stories"
  on public.stories for delete
  using (
    exists (
      select 1 from public.children
      where children.id = stories.child_id
        and children.user_id = auth.uid()
    )
  );
