-- SKYFIT ZONE - Supabase Schema (v2 - resets existing table with CASCADE)
-- Run this in Supabase SQL Editor

DROP TABLE IF EXISTS memberships CASCADE;

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  plan_id TEXT,
  category TEXT,
  category_label TEXT,
  plan_name TEXT,
  duration_label TEXT,
  price INTEGER,
  duration_days INTEGER,
  sessions INTEGER,
  member_name TEXT NOT NULL,
  member_email TEXT NOT NULL,
  member_phone TEXT,
  start_date DATE,
  expires DATE,
  is_active BOOLEAN DEFAULT true,
  trainer_id TEXT,
  trainer_name TEXT,
  trainer_role TEXT,
  trainer_initials TEXT,
  payment_method TEXT,
  payment_transaction TEXT,
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT 'checkout',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ
);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON memberships FOR SELECT USING (true);
CREATE POLICY "Admin all" ON memberships FOR ALL USING (true);