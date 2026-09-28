-- Keep the public membership catalog aligned with the displayed pricing cards.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_label TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS save_text TEXT;

UPDATE plans SET duration_label = '30 days' WHERE id IN ('gym-monthly', 'transform-monthly');
UPDATE plans SET duration_label = '90 days', tag = 'POPULAR' WHERE id IN ('gym-quarterly', 'transform-quarterly', 'pt-quarterly');
UPDATE plans SET duration_label = '180 days', tag = 'VALUE' WHERE id IN ('gym-halfyearly', 'transform-halfyearly', 'pt-halfyearly');
UPDATE plans SET duration_label = '365 days', tag = 'BEST VALUE' WHERE id IN ('gym-yearly', 'transform-yearly', 'pt-yearly');
UPDATE plans SET duration_label = '30 days (Per Session)' WHERE id = 'pt-onetime';

UPDATE plans SET save_text = 'Save ₹398' WHERE id = 'gym-quarterly';
UPDATE plans SET save_text = 'Save ₹2,295' WHERE id = 'gym-halfyearly';
UPDATE plans SET save_text = 'Save ₹5,589' WHERE id = 'gym-yearly';
UPDATE plans SET save_text = 'Save ₹498' WHERE id = 'transform-quarterly';
UPDATE plans SET save_text = 'Save ₹1,995' WHERE id = 'transform-halfyearly';
UPDATE plans SET save_text = 'Save ₹5,989' WHERE id = 'transform-yearly';

UPDATE plans SET duration_label = duration_days || ' days'
WHERE duration_label IS NULL;
