-- ─────────────────────────────────────────────────────────────────────────────
-- Collar — Database Schema
-- Siloed deployment model: one database per team.
-- No project_id needed — the database itself is the boundary.
-- Run this against a fresh Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'author', 'developer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'author', 'developer')),
  invited_by  UUID REFERENCES public.users(id),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.rules (
  id          TEXT PRIMARY KEY,   -- e.g. "BR-014", "SC-002"
  category    TEXT NOT NULL CHECK (category IN ('business', 'architectural', 'security', 'test')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  created_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  fork_commit_sha TEXT,
  forked_from     TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'deleted'))
);

CREATE TABLE public.commits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha           TEXT NOT NULL UNIQUE,
  branch        TEXT NOT NULL,
  author_id     UUID REFERENCES public.users(id),
  committed_at  TIMESTAMPTZ NOT NULL,
  parent_sha    TEXT,
  message       TEXT
);

CREATE TABLE public.snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_id   UUID REFERENCES public.commits(id),
  trigger     TEXT NOT NULL CHECK (trigger IN ('commit', 'rule_update', 'manual')),
  total       INTEGER NOT NULL DEFAULT 0,
  critical    INTEGER NOT NULL DEFAULT 0,
  major       INTEGER NOT NULL DEFAULT 0,
  minor       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.violations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     UUID REFERENCES public.snapshots(id),
  rule_id         TEXT REFERENCES public.rules(id),
  file_path       TEXT NOT NULL,
  line_start      INTEGER,
  line_end        INTEGER,
  code_excerpt    TEXT,
  explanation     TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'suppressed')),
  authored_by     UUID REFERENCES public.users(id),
  first_seen_sha  TEXT,
  resolved_sha    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_commits_branch        ON public.commits(branch);
CREATE INDEX idx_commits_sha           ON public.commits(sha);
CREATE INDEX idx_snapshots_commit_id   ON public.snapshots(commit_id);
CREATE INDEX idx_violations_snapshot   ON public.violations(snapshot_id);
CREATE INDEX idx_violations_status     ON public.violations(status);
CREATE INDEX idx_violations_file       ON public.violations(file_path);


-- ─── Row Level Security ───────────────────────────────────────────────────────
-- All tables require the user to exist in public.users.
-- The database is the project boundary — if you're in this DB, you're on the team.

ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations  ENABLE ROW LEVEL SECURITY;

-- Helper function used by all RLS policies
CREATE OR REPLACE FUNCTION public.is_team_member()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid()
  )
$$ LANGUAGE sql SECURITY DEFINER;

-- Users
CREATE POLICY "team_members_read_users"
  ON public.users FOR SELECT
  USING (public.is_team_member());

-- Invitations (read-only from plugin — managed via Supabase dashboard)
CREATE POLICY "team_members_read_invitations"
  ON public.invitations FOR SELECT
  USING (public.is_team_member());

-- Rules (read-only from plugin)
CREATE POLICY "team_members_read_rules"
  ON public.rules FOR SELECT
  USING (public.is_team_member());

-- Branches
CREATE POLICY "team_members_read_branches"
  ON public.branches FOR SELECT
  USING (public.is_team_member());

CREATE POLICY "team_members_write_branches"
  ON public.branches FOR INSERT
  WITH CHECK (public.is_team_member());

CREATE POLICY "team_members_update_branches"
  ON public.branches FOR UPDATE
  USING (public.is_team_member());

-- Commits
CREATE POLICY "team_members_read_commits"
  ON public.commits FOR SELECT
  USING (public.is_team_member());

CREATE POLICY "team_members_write_commits"
  ON public.commits FOR INSERT
  WITH CHECK (public.is_team_member());

-- Snapshots
CREATE POLICY "team_members_read_snapshots"
  ON public.snapshots FOR SELECT
  USING (public.is_team_member());

CREATE POLICY "team_members_write_snapshots"
  ON public.snapshots FOR INSERT
  WITH CHECK (public.is_team_member());

-- Violations
CREATE POLICY "team_members_read_violations"
  ON public.violations FOR SELECT
  USING (public.is_team_member());

CREATE POLICY "team_members_write_violations"
  ON public.violations FOR INSERT
  WITH CHECK (public.is_team_member());

CREATE POLICY "team_members_update_violations"
  ON public.violations FOR UPDATE
  USING (public.is_team_member());


-- ─── Invitation Trigger ───────────────────────────────────────────────────────
-- Runs on every new auth.users insert.
-- If no pending invitation exists for the email → rolls back the entire transaction.
-- The auth user record is never saved. No session is issued. Cannot be bypassed.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Block sign-in if no pending invitation exists
  IF NOT EXISTS (
    SELECT 1 FROM public.invitations
    WHERE email = NEW.email
    AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'No pending invitation found for %', NEW.email;
  END IF;

  -- Invitation found — create the user record with role from the invitation
  INSERT INTO public.users (id, name, email, role)
  SELECT
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    invitations.role
  FROM public.invitations
  WHERE email = NEW.email
  AND status = 'pending';

  -- Mark invitation as accepted — single use enforcement
  UPDATE public.invitations
  SET status = 'accepted'
  WHERE email = NEW.email
  AND status = 'pending';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_auth_user();


-- ─── Seed Rules ───────────────────────────────────────────────────────────────
-- Insert your initial rule set before testing.
-- Rules are managed here (or via Supabase dashboard), not via the plugin.

INSERT INTO public.rules (id, category, name, description, severity, status) VALUES
  ('BR-001', 'business',      'Consent Before Payment',       'Payment operations must verify user consent before execution. The consent flag must be checked and confirmed true before any call to processPayment or similar functions.', 'critical', 'active'),
  ('BR-002', 'business',      'Idempotency Keys Required',    'All payment and order mutation endpoints must include an idempotency key to prevent duplicate operations on retry.', 'major', 'active'),
  ('AR-001', 'architectural', 'No UI to DB Direct Calls',     'UI layer components must not import from or call database modules directly. All data access must go through a service or API layer.', 'critical', 'active'),
  ('AR-002', 'architectural', 'Feature Folder Isolation',     'Files inside a feature folder must not import from another feature folder directly. Cross-feature communication must go through the event bus.', 'major', 'active'),
  ('AR-003', 'architectural', 'No Supabase in Features',      'Feature files must not import @supabase/supabase-js or the Supabase client directly. They must only import from services/db, services/auth, or services/realtime.', 'critical', 'active'),
  ('SC-001', 'security',      'No Secrets in Source',         'API keys, passwords, tokens, and connection strings must not appear as string literals in source code. Use environment variables or a secrets manager.', 'critical', 'active'),
  ('SC-002', 'security',      'Input Sanitisation Required',  'All user-supplied input that is used in database queries, shell commands, or rendered as HTML must be sanitised or parameterised before use.', 'critical', 'active'),
  ('SC-003', 'security',      'JWT Expiry Must Be Set',       'JWT tokens issued by this service must include an expiry claim (exp). Tokens without expiry are a security risk.', 'major', 'active'),
  ('TS-001', 'test',          'No Empty Test Blocks',         'Test blocks (it, test, describe) must contain at least one assertion. Empty test blocks give false confidence and must be removed or completed.', 'major', 'active'),
  ('TS-002', 'test',          'Meaningful Assertions',        'Tests must assert on specific values or behaviours, not just that a function was called. Assertions like expect(true).toBe(true) are not meaningful.', 'minor', 'active');
