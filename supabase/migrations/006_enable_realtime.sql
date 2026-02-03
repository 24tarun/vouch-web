-- 1. Enable Realtime for the tables
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table friendships;

-- 2. Ensure we get old data on deletes (for seamless friend removal)
alter table tasks replica identity full;
alter table friendships replica identity full;