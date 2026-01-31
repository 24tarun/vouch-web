-- Vouch MVP Initial Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      SPLIT_PART(NEW.email, '@', 1) || '_' || SUBSTRING(NEW.id::TEXT, 1, 8)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- FRIENDSHIPS
-- ============================================
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, friend_id),
  CHECK (user_id != friend_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Friendships policies
CREATE POLICY "Users can view own friendships" ON friendships
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create friendships" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own friendships" ON friendships
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- TASKS
-- ============================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  failure_cost_cents INT NOT NULL CHECK (failure_cost_cents >= 1 AND failure_cost_cents <= 10000),
  deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED', 'ACTIVE', 'POSTPONED', 'MARKED_COMPLETED',
    'AWAITING_VOUCHER', 'COMPLETED', 'FAILED', 'RECTIFIED', 'SETTLED'
  )),
  postponed_at TIMESTAMPTZ,
  marked_completed_at TIMESTAMPTZ,
  voucher_response_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Tasks policies
CREATE POLICY "Users can view own tasks" ON tasks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Vouchers can view assigned tasks" ON tasks
  FOR SELECT USING (auth.uid() = voucher_id);

CREATE POLICY "Users can create own tasks" ON tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks" ON tasks
  FOR UPDATE USING (auth.uid() = user_id);

-- Vouchers can update tasks they're assigned to (for accept/deny)
CREATE POLICY "Vouchers can update assigned tasks" ON tasks
  FOR UPDATE USING (auth.uid() = voucher_id);

-- ============================================
-- TASK EVENTS (Audit Log)
-- ============================================
CREATE TABLE task_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES profiles(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;

-- Task events policies
CREATE POLICY "Users can view events for own tasks" ON task_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_events.task_id
      AND (tasks.user_id = auth.uid() OR tasks.voucher_id = auth.uid())
    )
  );

CREATE POLICY "System can insert events" ON task_events
  FOR INSERT WITH CHECK (auth.uid() = actor_id);

-- ============================================
-- LEDGER ENTRIES
-- ============================================
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- YYYY-MM format
  amount_cents INT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('failure', 'rectified')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ledger" ON ledger_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert ledger entries" ON ledger_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- RECTIFY PASSES
-- ============================================
CREATE TABLE rectify_passes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  authorized_by UUID NOT NULL REFERENCES profiles(id),
  period TEXT NOT NULL, -- YYYY-MM format
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE rectify_passes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rectify passes" ON rectify_passes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Vouchers can view authorized passes" ON rectify_passes
  FOR SELECT USING (auth.uid() = authorized_by);

CREATE POLICY "System can insert rectify passes" ON rectify_passes
  FOR INSERT WITH CHECK (
    auth.uid() = authorized_by
    AND EXISTS (
      SELECT 1 FROM tasks WHERE tasks.id = task_id AND tasks.voucher_id = auth.uid()
    )
  );

-- ============================================
-- FORCE MAJEURE
-- ============================================
CREATE TABLE force_majeure (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- YYYY-MM format
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE force_majeure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own force majeure" ON force_majeure
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own force majeure" ON force_majeure
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get current period (YYYY-MM)
CREATE OR REPLACE FUNCTION current_period()
RETURNS TEXT AS $$
BEGIN
  RETURN TO_CHAR(NOW(), 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;

-- Count rectify passes used this month
CREATE OR REPLACE FUNCTION rectify_passes_used(p_user_id UUID)
RETURNS INT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*) FROM rectify_passes
    WHERE user_id = p_user_id AND period = current_period()
  );
END;
$$ LANGUAGE plpgsql;

-- Check if force majeure available this month
CREATE OR REPLACE FUNCTION force_majeure_available(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM force_majeure
    WHERE user_id = p_user_id AND period = current_period()
  );
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_voucher_id ON tasks(voucher_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_deadline ON tasks(deadline);
CREATE INDEX idx_friendships_user_id ON friendships(user_id);
CREATE INDEX idx_friendships_friend_id ON friendships(friend_id);
CREATE INDEX idx_ledger_user_period ON ledger_entries(user_id, period);
CREATE INDEX idx_task_events_task_id ON task_events(task_id);
