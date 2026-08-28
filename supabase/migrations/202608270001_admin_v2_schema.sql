-- =============================================================================
-- SKYFIT ZONE — Admin Platform Schema V2 (additive, robust, non-breaking)
-- Fixes column existence checks for member_email and status
-- Run in Supabase SQL Editor
-- =============================================================================

-- 1. Ensure member_email column exists on memberships table
ALTER TABLE memberships 
ADD COLUMN IF NOT EXISTS member_email TEXT;

-- If an existing table used "email" instead of "member_email", backfill it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'memberships' AND column_name = 'email'
  ) THEN
    UPDATE memberships SET member_email = email WHERE member_email IS NULL OR member_email = '';
  END IF;
END $$;

-- 2. Ensure status & is_active columns exist in memberships table
ALTER TABLE memberships 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';

ALTER TABLE memberships 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Drop existing constraint if present to avoid duplicate constraint errors
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_status_check 
  CHECK (status IN ('PENDING','ACTIVE','EXPIRED','SUSPENDED','CANCELLED'));

-- 3. Backfill status column based on expires & is_active
UPDATE memberships 
SET status = CASE 
  WHEN is_active = false THEN 'CANCELLED'
  WHEN expires < CURRENT_DATE THEN 'EXPIRED'
  ELSE 'ACTIVE'
END
WHERE status IS NULL OR status = 'ACTIVE';

-- 4. Create missing tables if they don't exist yet (Defense-in-Depth)

CREATE TABLE IF NOT EXISTS staff_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','STAFF','TRAINER')),
  trainer_id    TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  created_by    TEXT,
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id       TEXT,
  member_email        TEXT NOT NULL,
  member_name         TEXT,
  plan_name           TEXT,
  amount              INTEGER NOT NULL DEFAULT 0,
  currency            TEXT DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','FAILED','REFUNDED','CANCELLED')),
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  payment_method      TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email  TEXT NOT NULL,
  member_name   TEXT,
  entry_time    TIMESTAMPTZ DEFAULT now(),
  exit_time     TIMESTAMPTZ,
  access_method TEXT NOT NULL DEFAULT 'fingerprint',
  device_id     UUID,
  status        TEXT NOT NULL DEFAULT 'GRANTED' CHECK (status IN ('GRANTED','DENIED')),
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  location       TEXT,
  identifier     TEXT,
  status         TEXT NOT NULL DEFAULT 'ONLINE',
  last_heartbeat TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email  TEXT,
  member_name   TEXT,
  device_id     UUID,
  device_name   TEXT,
  access_method TEXT NOT NULL DEFAULT 'fingerprint',
  status        TEXT NOT NULL DEFAULT 'GRANTED',
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS biometric_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email   TEXT NOT NULL UNIQUE,
  device_id      UUID,
  device_user_id TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'REGISTERED',
  registered_at  TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email  TEXT,
  actor_role   TEXT,
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  details      JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT DEFAULT '',
  related_id  TEXT,
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  gym_name       TEXT DEFAULT 'SKYFIT ZONE',
  logo           TEXT,
  tagline        TEXT DEFAULT '',
  description    TEXT DEFAULT '',
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  opening_hours  TEXT DEFAULT '',
  whatsapp       TEXT,
  instagram      TEXT,
  facebook       TEXT,
  youtube        TEXT,
  google_maps    TEXT,
  hero_text      TEXT DEFAULT '',
  cta_text       TEXT DEFAULT '',
  updated_at     TIMESTAMPTZ DEFAULT now()
);
INSERT INTO gym_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 5. Safe Index Creation (Checked after column additions)
CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_expires ON memberships(expires);
CREATE INDEX IF NOT EXISTS idx_memberships_member_email ON memberships(member_email);
CREATE INDEX IF NOT EXISTS idx_payments_status_date ON payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_attendance_entry ON attendance(entry_time);
CREATE INDEX IF NOT EXISTS idx_access_logs_entry ON access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_biometric_device_user ON biometric_members(device_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

-- 6. Enable RLS on all tables
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_settings ENABLE ROW LEVEL SECURITY;

-- 7. Service role full access policy
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff_profiles','plans','trainers','services','media_assets','transformations',
    'enquiries','progress_records','workout_sessions','attendance','access_devices',
    'access_logs','biometric_members','audit_logs','notifications','payments',
    'gym_settings','memberships'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%I" ON %I;', t, t);
      EXECUTE format('CREATE POLICY "service_role_all_%I" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);', t, t);
    END IF;
  END LOOP;
END $$;
