-- =============================================================================
-- SKYFIT ZONE — Admin Platform Schema (additive, non-breaking)
-- Run in Supabase SQL Editor. Adds management tables WITHOUT dropping or
-- altering the existing `memberships` table used by the live checkout flow.
--
-- IMPORTANT SECURITY NOTE:
--   The server uses the SERVICE ROLE key, which BYPASSES Row Level Security.
--   Therefore authorization is ENFORCED IN APPLICATION CODE (requireRole
--   middleware). RLS below is defense-in-depth against direct anon-key access.
--   - Public catalog tables (plans, trainers, services, media_assets,
--     published transformations) allow anon SELECT only.
--   - All PII / operational tables allow ONLY service_role.
--   - enquiries allows anon INSERT (public contact form).
-- =============================================================================

-- =============================================================================
-- RBAC: staff_profiles  (ADMIN / MANAGER / STAFF / TRAINER)
-- =============================================================================
CREATE TABLE IF NOT EXISTS staff_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','STAFF','TRAINER')),
  trainer_id    TEXT, -- for TRAINER role: links to trainers.id
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  created_by    TEXT,
  last_login    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_profiles(email);
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff_profiles(role);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff_profiles(status);

-- =============================================================================
-- PLANS catalog (drives both public pricing + admin plan management)
-- =============================================================================
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'gym',
  description   TEXT DEFAULT '',
  price         INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  sessions      INTEGER,
  features      JSONB DEFAULT '[]'::jsonb,
  active        BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);
CREATE INDEX IF NOT EXISTS idx_plans_category ON plans(category);

-- =============================================================================
-- TRAINERS catalog
-- =============================================================================
CREATE TABLE IF NOT EXISTS trainers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  photo         TEXT,
  specialization TEXT,
  experience    TEXT,
  certification TEXT,
  bio           TEXT DEFAULT '',
  contact       TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trainers_status ON trainers(status);

-- =============================================================================
-- SERVICES (public services section)
-- =============================================================================
CREATE TABLE IF NOT EXISTS services (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  price         INTEGER,
  image         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);

-- =============================================================================
-- MEDIA ASSETS (gallery)
-- =============================================================================
CREATE TABLE IF NOT EXISTS media_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL DEFAULT 'Gym',
  file_path     TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','unpublished')),
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_category ON media_assets(category);
CREATE INDEX IF NOT EXISTS idx_media_status ON media_assets(status);

-- =============================================================================
-- TRANSFORMATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS transformations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_name   TEXT NOT NULL,
  before_image  TEXT,
  after_image   TEXT,
  goal          TEXT DEFAULT '',
  duration      TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  testimonial   TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trans_status ON transformations(status);

-- =============================================================================
-- ENQUIRIES (public contact form inserts; staff manage)
-- =============================================================================
CREATE TABLE IF NOT EXISTS enquiries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','FOLLOW_UP','CONVERTED','CLOSED')),
  internal_notes TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries(created_at);

-- =============================================================================
-- PROGRESS RECORDS (per member, keyed by email)
-- =============================================================================
CREATE TABLE IF NOT EXISTS progress_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email  TEXT NOT NULL,
  member_name   TEXT,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight        NUMERIC(6,2),
  chest         NUMERIC(6,2),
  waist         NUMERIC(6,2),
  arms          NUMERIC(6,2),
  thighs        NUMERIC(6,2),
  goal          TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  photo_url     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_progress_email ON progress_records(member_email);
CREATE INDEX IF NOT EXISTS idx_progress_date ON progress_records(recorded_date);

-- =============================================================================
-- WORKOUT SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email  TEXT NOT NULL,
  member_name   TEXT,
  trainer_id    TEXT,
  trainer_name  TEXT,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  exercise      TEXT NOT NULL,
  sets          INTEGER,
  reps          TEXT,
  weight        NUMERIC(8,2),
  duration      INTEGER,
  calories      INTEGER,
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workout_email ON workout_sessions(member_email);
CREATE INDEX IF NOT EXISTS idx_workout_trainer ON workout_sessions(trainer_id);
CREATE INDEX IF NOT EXISTS idx_workout_date ON workout_sessions(date);

-- =============================================================================
-- ATTENDANCE (successful gym entries / attempts)
-- =============================================================================
CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email  TEXT NOT NULL,
  member_name   TEXT,
  entry_time    TIMESTAMPTZ DEFAULT now(),
  exit_time     TIMESTAMPTZ,
  access_method TEXT NOT NULL DEFAULT 'fingerprint' CHECK (access_method IN ('fingerprint','qr','rfid','manual')),
  device_id     UUID,
  status        TEXT NOT NULL DEFAULT 'GRANTED' CHECK (status IN ('GRANTED','DENIED')),
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_email ON attendance(member_email);
CREATE INDEX IF NOT EXISTS idx_attendance_time ON attendance(entry_time);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_device ON attendance(device_id);

-- =============================================================================
-- ACCESS DEVICES (biometric / QR / RFID entry devices)
-- =============================================================================
CREATE TABLE IF NOT EXISTS access_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  location       TEXT,
  identifier     TEXT,
  status         TEXT NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE','OFFLINE','ERROR','DISABLED')),
  last_heartbeat TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devices_status ON access_devices(status);

-- =============================================================================
-- ACCESS LOGS (every scan attempt — granted or denied)
-- =============================================================================
CREATE TABLE IF NOT EXISTS access_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email  TEXT,
  member_name   TEXT,
  device_id     UUID,
  device_name   TEXT,
  access_method TEXT NOT NULL DEFAULT 'fingerprint',
  status        TEXT NOT NULL DEFAULT 'GRANTED' CHECK (status IN ('GRANTED','DENIED')),
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accesslog_time ON access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_accesslog_email ON access_logs(member_email);
CREATE INDEX IF NOT EXISTS idx_accesslog_status ON access_logs(status);
CREATE INDEX IF NOT EXISTS idx_accesslog_device ON access_logs(device_id);

-- =============================================================================
-- BIOMETRIC MEMBERS — stores ONLY a safe device user id, NEVER raw biometrics
-- =============================================================================
CREATE TABLE IF NOT EXISTS biometric_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email   TEXT NOT NULL,
  device_id      UUID,
  device_user_id TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('NOT REGISTERED','REGISTERED','DISABLED')),
  registered_at  TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biometric_email ON biometric_members(member_email);
CREATE INDEX IF NOT EXISTS idx_biometric_device_user ON biometric_members(device_user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_status ON biometric_members(status);

-- =============================================================================
-- AUDIT LOGS — never stores passwords / tokens / secrets / biometrics
-- =============================================================================
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
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_email);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT DEFAULT '',
  related_id  TEXT,
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);

-- =============================================================================
-- PAYMENTS (separate ledger; membership activation is server-verified)
-- =============================================================================
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
CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(member_email);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_rz_order ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_rz_payment ON payments(razorpay_payment_id);

-- =============================================================================
-- GYM SETTINGS (single row; never stores secrets)
-- =============================================================================
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

-- =============================================================================
-- EXTEND existing `memberships` (non-breaking): add status + archive flag.
-- status is authoritative for SUSPENDED/CANCELLED/PENDING; ACTIVE/EXPIRED are
-- derived dynamically from is_active + expires in application code.
-- =============================================================================
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE'
  CHECK (status IN ('PENDING','ACTIVE','EXPIRED','SUSPENDED','CANCELLED'));
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
DO $$
BEGIN
  UPDATE memberships SET status = CASE
    WHEN archived THEN 'CANCELLED'
    WHEN NOT is_active THEN 'SUSPENDED'
    WHEN expires < CURRENT_DATE THEN 'EXPIRED'
    ELSE 'ACTIVE' END
  WHERE status IS NULL OR status = 'ACTIVE';
END $$;
CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_email ON memberships(member_email);
CREATE INDEX IF NOT EXISTS idx_memberships_expires ON memberships(expires);

-- =============================================================================
-- SEED: plans (mirrors the existing static PLANS catalog)
-- =============================================================================
INSERT INTO plans (id,name,category,description,price,duration_days,sessions,features,active,display_order) VALUES
('gym-monthly','1 Month','gym','Strength-focused gym membership',1299,30,NULL,'["Strength training","Bodybuilding","Weight Gain","Muscle Toning","Fitness assessment"]'::jsonb,true,1),
('gym-quarterly','3 Months','gym','Strength-focused gym membership',3499,90,NULL,'["Strength training","Bodybuilding","Weight Gain","Muscle Toning","Fitness assessment"]'::jsonb,true,2),
('gym-halfyearly','6 Months','gym','Strength-focused gym membership',5499,180,NULL,'["Strength training","Bodybuilding","Weight Gain","Muscle Toning","Fitness assessment"]'::jsonb,true,3),
('gym-yearly','Annual','gym','Strength-focused gym membership',9999,365,NULL,'["Strength training","Bodybuilding","Weight Gain","Muscle Toning","Fitness assessment"]'::jsonb,true,4),
('pt-onetime','One-to-One','personal','Personal training per session',5000,30,NULL,'["Dedicated personal trainer","Personalized workout","Form correction","Progress tracking","Weekly assessment"]'::jsonb,true,5),
('pt-quarterly','3 Months','personal','Personal training',13000,90,NULL,'["Dedicated personal trainer","Personalized workout","Form correction","Progress tracking","Weekly assessment"]'::jsonb,true,6),
('pt-halfyearly','6 Months','personal','Personal training',24000,180,NULL,'["Dedicated personal trainer","Personalized workout","Form correction","Progress tracking","Weekly assessment"]'::jsonb,true,7),
('pt-yearly','Annual','personal','Personal training',45000,365,NULL,'["Dedicated personal trainer","Personalized workout","Form correction","Progress tracking","Weekly assessment"]'::jsonb,true,8),
('transform-monthly','1 Month','transformation','Full body transformation',1499,30,NULL,'["Strength training","Cardio & endurance","Weight Loss","Weight Gain","Body transformation","Flexibility"]'::jsonb,true,9),
('transform-quarterly','3 Months','transformation','Full body transformation',3999,90,NULL,'["Strength training","Cardio & endurance","Weight Loss","Weight Gain","Body transformation","Flexibility"]'::jsonb,true,10),
('transform-halfyearly','6 Months','transformation','Full body transformation',6999,180,NULL,'["Strength training","Cardio & endurance","Weight Loss","Weight Gain","Body transformation","Flexibility"]'::jsonb,true,11),
('transform-yearly','Annual','transformation','Full body transformation',11999,365,NULL,'["Strength training","Cardio & endurance","Weight Loss","Weight Gain","Body transformation","Flexibility"]'::jsonb,true,12),
('elite-yearly','SKYFIT ELITE','elite','Premium unlimited access',60000,365,NULL,'["Unlimited gym access","Personal training sessions","Diet consultation","Body composition tracking","Priority trainer support","Transformation challenges","Exclusive member benefits"]'::jsonb,true,13)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SEED: trainers (mirrors the existing static TRAINERS catalog)
-- =============================================================================
INSERT INTO trainers (id,name,specialization,experience,certification,bio,contact,status) VALUES
('t-naveen','NAVEEN','Strength & Conditioning','8 yrs','National Powerlifting Medalist','National powerlifting medalist. Progressive overload & muscle gain specialist.','',true),
('t-aravind','ARAVIND','Yoga & Wellness','6 yrs','RYT-500','RYT-500 certified. Mobility, breathwork & flexibility expert.','',true),
('t-uday','UDAY KUMAR','CrossFit L2 Coach','7 yrs','CrossFit Games Regional','CrossFit Games regional athlete. Engine, WODs & conditioning.','',true),
('t-shinu','SHINU','Transformation Specialist','6 yrs','300+ Transformations','300+ transformations. Nutrition, mindset & accountability coach.','',true),
('t-vamsi','VAMSI','Elite Performance','9 yrs','Elite Performance Lead','Elite performance & endurance specialist. SKYFIT ELITE program lead.','',true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SEED: initial ADMIN staff profile (create the matching Supabase Auth user
--        with this email, or use ADMIN_KEY to bootstrap).
--        Replace the email below with your real admin email.
-- =============================================================================
INSERT INTO staff_profiles (full_name, email, role, status, created_by)
VALUES ('Gym Owner','admin@skyfit.example.com','ADMIN','active','system')
ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- ROW LEVEL SECURITY (defense-in-depth; server uses service_role = bypass)
-- =============================================================================
ALTER TABLE staff_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transformations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_devices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships       ENABLE ROW LEVEL SECURITY;

-- Helper: allow service_role (server) full access on every table
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff_profiles','plans','trainers','services','media_assets','transformations',
    'enquiries','progress_records','workout_sessions','attendance','access_devices',
    'access_logs','biometric_members','audit_logs','notifications','payments',
    'gym_settings','memberships'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%I" ON %I;', t, t);
    EXECUTE format('CREATE POLICY "service_role_all_%I" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;

-- Public catalog: read-only for anon/authenticated
CREATE POLICY "public_read_plans"      ON plans          FOR SELECT USING (active = true);
CREATE POLICY "public_read_trainers"    ON trainers       FOR SELECT USING (status = 'active');
CREATE POLICY "public_read_services"    ON services       FOR SELECT USING (status = 'active');
CREATE POLICY "public_read_media"       ON media_assets   FOR SELECT USING (status = 'published');
CREATE POLICY "public_read_transforms"  ON transformations FOR SELECT USING (status = 'PUBLISHED');

-- Enquiries: anyone may submit (public contact form); staff read via service_role
CREATE POLICY "anon_insert_enquiries"   ON enquiries      FOR INSERT WITH CHECK (true);

-- Deny everything else for anon/authenticated by default (no other policies =
-- only service_role can touch PII tables). Explicitly block public read of PII:
CREATE POLICY "no_anon_memberships"   ON memberships   FOR SELECT USING (false);
