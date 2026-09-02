-- =============================================================================
-- SKYFIT ZONE - Gym Announcements
-- Broadcast announcements from gym admin to all web users.
-- Public web polls /api/announcements; admin manages via /api/admin/announcements
-- Additive, idempotent migration. Run in Supabase SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','success','urgent')),
  priority    INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  is_pinned   BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_announcements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements;
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_announcements_updated_at();

-- Enable RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Public: can read only active, non-expired announcements
DROP POLICY IF EXISTS announcements_select_public ON announcements;
CREATE POLICY announcements_select_public ON announcements
  FOR SELECT USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Authenticated/Service role: full access (defense-in-depth; app uses service_role which bypasses RLS)
DROP POLICY IF EXISTS announcements_all_auth ON announcements;
CREATE POLICY announcements_all_auth ON announcements
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_announcements_active_pinned ON announcements(is_active, is_pinned, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_expires ON announcements(expires_at);

-- Seed example (only if empty)
INSERT INTO announcements (title, message, type, priority, is_pinned, is_active)
SELECT 'Welcome to SKYFIT ZONE!', 'New transformation batch starts Monday — enroll now and get 10% off.', 'info', 10, true, true
WHERE NOT EXISTS (SELECT 1 FROM announcements);
