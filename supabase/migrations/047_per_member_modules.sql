-- ============================================
-- Per-member module access. Replaces the alpha/lifetime tier flags on
-- app_modules with an explicit list on each member. Admins still see
-- everything via plan='admin'.
--
-- The `plan` column is kept (its check just widens to allow 'member' as a
-- new value) so existing rows don't trip a constraint. The per-tier flags
-- on app_modules (alpha_enabled / lifetime_enabled) stay too, just unused
-- — the next migration could drop them once we're confident.
--
-- Backfill: any member whose modules list is still empty gets the keys
-- their old plan + per-tier flags would have granted, so live members
-- don't lose access on deploy. Idempotent.
-- ============================================

ALTER TABLE app_members ADD COLUMN IF NOT EXISTS modules TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE app_members DROP CONSTRAINT IF EXISTS app_members_plan_check;
ALTER TABLE app_members
  ADD CONSTRAINT app_members_plan_check
  CHECK (plan IN ('alpha', 'lifetime', 'admin', 'member'));

UPDATE app_members AS m
SET modules = sub.module_keys, updated_at = NOW()
FROM (
  SELECT mm.id, ARRAY_AGG(am.key ORDER BY am.key) AS module_keys
  FROM app_members mm
  CROSS JOIN app_modules am
  WHERE mm.plan IN ('alpha', 'lifetime')
    AND ((mm.plan = 'alpha' AND am.alpha_enabled)
         OR (mm.plan = 'lifetime' AND am.lifetime_enabled))
  GROUP BY mm.id
) sub
WHERE m.id = sub.id
  AND (m.modules IS NULL OR array_length(m.modules, 1) IS NULL);
