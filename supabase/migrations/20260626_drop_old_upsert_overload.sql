-- ============================================================
-- SCR-GBTI-02 Patch: Drop insecure old upsert_package_layout
-- overload (2-argument version without session token check)
--
-- The previous migration (20260626_fix_anon_write_access.sql)
-- added a new 3-argument version with token verification, but
-- the original 2-argument version from
-- 20260624_schema_disclosure_fix.sql still exists alongside it.
-- PostgREST returns PGRST203 (ambiguous overload) when called
-- without a token — both functions are visible to anon.
-- The old 2-arg version must be dropped so the only callable
-- function is the secure 3-arg version.
-- ============================================================

-- Drop the old insecure 2-argument overload
DROP FUNCTION IF EXISTS api.upsert_package_layout(TEXT, JSONB);

-- The 3-argument version with session token gate remains:
--   api.upsert_package_layout(p_package_key TEXT, p_plan_data JSONB, p_token TEXT)
-- Verify it's still there:
-- SELECT proname, pronargs, proargnames
-- FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'api' AND p.proname = 'upsert_package_layout';
-- Expected: 1 row, pronargs=3

-- Re-grant execute (in case the DROP CASCADE removed grants)
GRANT EXECUTE ON FUNCTION api.upsert_package_layout(TEXT, JSONB, TEXT) TO anon, authenticated;
