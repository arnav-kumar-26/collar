-- ─────────────────────────────────────────────────────────────────────────────
-- Collar — Multi-tenant Schema
-- One central Supabase project shared by all teams.
-- Teams are isolated by project_id on every table, enforced by RLS.
-- Run this once against your central Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Core Tables ─────────────────────────────────────────────────────────────

CREATE TABLE public.projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.project_members (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'developer')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE public.invitations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'developer')),
  invited_by UUID REFERENCES public.users(id),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);


-- ─── Project-scoped Tables ────────────────────────────────────────────────────

CREATE TABLE public.rules (
  id          TEXT NOT NULL,
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('business', 'architectural', 'security', 'test')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, project_id)
);

CREATE TABLE public.branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  fork_commit_sha TEXT,
  forked_from     TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'deleted')),
  UNIQUE (project_id, name)
);

CREATE TABLE public.commits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sha          TEXT NOT NULL,
  branch       TEXT NOT NULL,
  author_id    UUID REFERENCES public.users(id),
  committed_at TIMESTAMPTZ NOT NULL,
  parent_sha   TEXT,
  message      TEXT,
  UNIQUE (project_id, sha)
);

CREATE TABLE public.snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  commit_id  UUID REFERENCES public.commits(id),
  trigger    TEXT NOT NULL CHECK (trigger IN ('commit', 'rule_update', 'manual')),
  total      INTEGER NOT NULL DEFAULT 0,
  critical   INTEGER NOT NULL DEFAULT 0,
  major      INTEGER NOT NULL DEFAULT 0,
  minor      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.violations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_id    UUID REFERENCES public.snapshots(id),
  rule_id        TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  line_start     INTEGER,
  line_end       INTEGER,
  code_excerpt   TEXT,
  explanation    TEXT,
  severity       TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'suppressed')),
  authored_by    UUID REFERENCES public.users(id),
  first_seen_sha TEXT,
  resolved_sha   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_project_members_project ON public.project_members(project_id);
CREATE INDEX idx_project_members_user    ON public.project_members(user_id);
CREATE INDEX idx_invitations_project     ON public.invitations(project_id);
CREATE INDEX idx_invitations_email       ON public.invitations(email);
CREATE INDEX idx_rules_project           ON public.rules(project_id);
CREATE INDEX idx_branches_project        ON public.branches(project_id);
CREATE INDEX idx_commits_project         ON public.commits(project_id);
CREATE INDEX idx_commits_sha             ON public.commits(sha);
CREATE INDEX idx_snapshots_project       ON public.snapshots(project_id);
CREATE INDEX idx_violations_project      ON public.violations(project_id);
CREATE INDEX idx_violations_status       ON public.violations(status);
CREATE INDEX idx_violations_file         ON public.violations(file_path);


-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations      ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
  )
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_project_admin(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    AND role = 'admin'
  )
$$ LANGUAGE sql SECURITY DEFINER;

-- Projects
CREATE POLICY "members_read_project"
  ON public.projects FOR SELECT
  USING (public.is_project_member(id));

-- Users — visible to anyone who shares at least one project with them
CREATE POLICY "members_read_users"
  ON public.users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm1
      JOIN public.project_members pm2 ON pm1.project_id = pm2.project_id
      WHERE pm1.user_id = auth.uid()
      AND pm2.user_id = users.id
    )
  );

-- Project members
CREATE POLICY "members_read_project_members"
  ON public.project_members FOR SELECT
  USING (public.is_project_member(project_id));

-- Invitations
CREATE POLICY "members_read_invitations"
  ON public.invitations FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "admins_write_invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "admins_update_invitations"
  ON public.invitations FOR UPDATE
  USING (public.is_project_admin(project_id));

-- Rules
CREATE POLICY "members_read_rules"
  ON public.rules FOR SELECT
  USING (public.is_project_member(project_id));

-- Branches
CREATE POLICY "members_read_branches"
  ON public.branches FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "members_write_branches"
  ON public.branches FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "members_update_branches"
  ON public.branches FOR UPDATE
  USING (public.is_project_member(project_id));

-- Commits
CREATE POLICY "members_read_commits"
  ON public.commits FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "members_write_commits"
  ON public.commits FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- Snapshots
CREATE POLICY "members_read_snapshots"
  ON public.snapshots FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "members_write_snapshots"
  ON public.snapshots FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- Violations
CREATE POLICY "members_read_violations"
  ON public.violations FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "members_write_violations"
  ON public.violations FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "members_update_violations"
  ON public.violations FOR UPDATE
  USING (public.is_project_member(project_id));

  CREATE POLICY "admins_write_rules"
  ON public.rules FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "admins_update_rules"
  ON public.rules FOR UPDATE
  USING (public.is_project_admin(project_id));


-- ─── Auth Trigger ─────────────────────────────────────────────────────────────
-- Fires on every new GitHub sign-in.
-- Blocks users with no pending invitation anywhere — same security guarantee
-- as the original design, now applied across all projects.
-- Automatically creates the user record and project_member records for every
-- project the email has been invited to, then marks those invitations accepted.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pending_count
  FROM public.invitations
  WHERE email = NEW.email
  AND status = 'pending';

  IF pending_count = 0 THEN
    RAISE EXCEPTION 'No pending invitation found for %. Ask your team admin to invite you.', NEW.email;
  END IF;

  INSERT INTO public.users (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.project_members (project_id, user_id, role)
  SELECT project_id, NEW.id, role
  FROM public.invitations
  WHERE email = NEW.email
  AND status = 'pending';

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