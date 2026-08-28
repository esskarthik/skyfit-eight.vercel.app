-- =============================================================================
-- SKYFIT ZONE - Supplement Marketplace
-- Additive, idempotent migration. Run in Supabase SQL Editor.
-- Adds a `supplements` product catalog for the marketplace (supplement store).
-- =============================================================================

-- 1. supplements table
CREATE TABLE IF NOT EXISTS supplements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE,
  name         TEXT NOT NULL,
  brand        TEXT,
  category     TEXT NOT NULL DEFAULT 'whey',
  price        NUMERIC(10,2) DEFAULT 0,
  mrp          NUMERIC(10,2),
  size         TEXT,
  flavor       TEXT,
  image_url    TEXT,
  description  TEXT,
  rating       NUMERIC(3,1) DEFAULT 5.0,
  stock        INTEGER DEFAULT 0,
  tags         TEXT[] DEFAULT '{}',
  is_featured  BOOLEAN DEFAULT false,
  is_active    BOOLEAN DEFAULT true,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Category check constraint
ALTER TABLE supplements DROP CONSTRAINT IF EXISTS supplements_category_check;
ALTER TABLE supplements ADD CONSTRAINT supplements_category_check
  CHECK (category IN ('pre_workout','whey','creatine','mass_gainer','vitamins','other'));

-- 2. RLS
ALTER TABLE supplements ENABLE ROW LEVEL SECURITY;

-- Public reads only expose active products
DROP POLICY IF EXISTS supplements_select_public ON supplements;
CREATE POLICY supplements_select_public ON supplements
  FOR SELECT USING (is_active = true);

-- Service role / authenticated writers (app uses service_role which bypasses RLS,
-- these policies are defense-in-depth for any anon/user JWT usage)
DROP POLICY IF EXISTS supplements_insert_auth ON supplements;
CREATE POLICY supplements_insert_auth ON supplements
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS supplements_update_auth ON supplements;
CREATE POLICY supplements_update_auth ON supplements
  FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS supplements_delete_auth ON supplements;
CREATE POLICY supplements_delete_auth ON supplements
  FOR DELETE USING (true);

-- 3. Default seed data (4 categories requested by user)
INSERT INTO supplements (slug, name, brand, category, price, mrp, size, flavor, image_url, description, rating, stock, tags, is_featured, sort_order)
VALUES
  ('pre-workout-nitro-pump', 'Nitro Pump',        'ProSupps',       'pre_workout', 1499, 1999, '300g / 30 servings', 'Blue Raspberry', NULL, 'High-energy pre-workout with caffeine, beta-alanine & citrulline for explosive lifts.', 4.6, 25, ARRAY['caffeine','beta-alanine','energy'], true, 1),
  ('whey-isolate-choco',     'Gold Whey Isolate', 'Optimum Nutrition','whey',       2699, 3299, '1kg / 30 servings', 'Chocolate',      NULL, 'Fast-absorbing whey protein isolate, 24g protein per scoop.', 4.8, 40, ARRAY['isolate','24g protein','lean muscle'], true, 2),
  ('creatine-micronized',    'Creatine Monohydrate','MuscleTech',    'creatine',     899, 1199, '400g / 80 servings', 'Unflavoured',    NULL, 'Micronized creatine monohydrate for strength & recovery.', 4.9, 60, ARRAY['strength','recovery','unflavoured'], true, 3),
  ('mass-gainer-6k',         'Serious Mass Gainer','Optimum Nutrition','mass_gainer', 2999, 3599, '3kg / 16 servings', 'Cookies & Cream',NULL, '1250 calories per serving to support extreme weight & muscle gain.', 4.5, 15, ARRAY['weight gain','mass','high calorie'], true, 4),
  ('whey-concentrate-vanilla','Whey Protein Concentrate','Dymatize','whey',         1999, 2499, '2kg / 50 servings', 'Vanilla',        NULL, 'Classic whey concentrate. Great value everyday protein.', 4.4, 35, ARRAY['concentrate','value','daily protein'], false, 5)
ON CONFLICT (slug) DO NOTHING;
