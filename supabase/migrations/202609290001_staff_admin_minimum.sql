-- Align staff authentication with the server's active-account checks.
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

UPDATE staff_profiles
SET is_active = (status IS NULL OR status = 'active')
WHERE is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_active_admin
  ON staff_profiles(is_active, role);
