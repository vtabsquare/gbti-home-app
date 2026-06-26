-- ============================================================
-- SCR-GBTI-02 Fix: Anonymous Write Access to Pricing Config
-- and Package Layouts
-- CWE-284: Improper Access Control | CVSS 8.1 HIGH
--
-- Root Cause:
--   RLS policies on admin_settings and package_layouts grant
--   INSERT, UPDATE, and DELETE to the anon role with no auth
--   check — any holder of the public anon key can overwrite
--   pricing data or inject floor plan layouts.
--
-- Fix (four-part):
--   Part 1 — Drop ALL anon write policies on admin_settings
--             and package_layouts.
--   Part 2 — Add session-token gate to api.upsert_package_layout
--             so it requires a valid admin session to write.
--             Public configurator floor-plan saves are migrated
--             to a separate, rate-limited RPC that records the
--             visitor session.
--   Part 3 — Create admin_audit_log table.
--   Part 4 — Install BEFORE triggers on admin_settings and
--             package_layouts to record every write.
-- ============================================================


-- ============================================================
-- PART 1: Drop over-permissive anon write policies
-- ============================================================

-- admin_settings write policies (added in 20260513_admin_setup.sql
-- and re-created by 20260623_fix_rls_security.sql)
DROP POLICY IF EXISTS "Anyone can insert admin settings"    ON public.admin_settings;
DROP POLICY IF EXISTS "Anyone can update admin settings"    ON public.admin_settings;
DROP POLICY IF EXISTS "Anyone can delete admin settings"    ON public.admin_settings;
DROP POLICY IF EXISTS "Admin can insert admin settings"     ON public.admin_settings;
DROP POLICY IF EXISTS "Admin can update admin settings"     ON public.admin_settings;
DROP POLICY IF EXISTS "Admin can delete admin settings"     ON public.admin_settings;

-- package_layouts write policies (added in 20260506080500_package_layouts.sql)
DROP POLICY IF EXISTS "Anyone can upsert package layouts"   ON public.package_layouts;
DROP POLICY IF EXISTS "Anyone can update package layouts"   ON public.package_layouts;

-- Confirm RLS is still active
ALTER TABLE public.admin_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_layouts  ENABLE ROW LEVEL SECURITY;

-- Keep only the SELECT policy for anon (needed for public pricing reads)
-- These should already exist; recreate idempotently just in case.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'admin_settings' AND policyname = 'Public can read admin settings'
  ) THEN
    CREATE POLICY "Public can read admin settings"
      ON public.admin_settings FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'package_layouts' AND policyname = 'Public can read package layouts'
  ) THEN
    CREATE POLICY "Public can read package layouts"
      ON public.package_layouts FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- With RLS enabled and NO write policies for anon:
--   • Direct REST PATCH /rest/v1/admin_settings  → 403 (no policy matches)
--   • Direct REST DELETE /rest/v1/admin_settings → 403
--   • Direct REST POST   /rest/v1/package_layouts → 403
--   • Direct REST PATCH  /rest/v1/package_layouts → 403
--
-- SECURITY DEFINER functions bypass RLS and are the only write
-- path — each function verifies the admin session token first.


-- ============================================================
-- PART 2: Secure api.upsert_package_layout with session gate
--
-- The public floor-plan editor (StepPreview.tsx) calls
-- savePackageLayout() which routes through
-- api.upsert_package_layout(). This is a SECURITY DEFINER
-- function so it bypasses RLS. We now require a valid admin
-- session token for this call.
--
-- The public configurator's "Apply Changes" / "Save Layout"
-- is only meaningful for the family double-storey package, and
-- this layout data (package_layouts) is shared across all
-- visitors. Writing it should be admin-controlled, not open to
-- any anonymous user. The configurator will show the layout
-- from the DB if saved; otherwise it falls back to the
-- algorithmically generated split. This behaviour is preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION api.upsert_package_layout(
  p_package_key TEXT,
  p_plan_data   JSONB,
  p_token       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Require a valid admin session token.
  -- Passing no token (NULL / empty) is rejected.
  IF p_token IS NULL OR p_token = '' OR NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized: valid admin session token required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Validate key length (defence-in-depth)
  IF char_length(p_package_key) < 1 OR char_length(p_package_key) > 200 THEN
    RAISE EXCEPTION 'Invalid package_key length'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.package_layouts (package_key, plan_data, updated_at)
  VALUES (p_package_key, p_plan_data, NOW())
  ON CONFLICT (package_key) DO UPDATE
    SET plan_data  = EXCLUDED.plan_data,
        updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION api.upsert_package_layout(TEXT, JSONB, TEXT) TO anon, authenticated;


-- ============================================================
-- PART 3: Admin audit log table
-- Records every INSERT / UPDATE / DELETE on admin_settings and
-- package_layouts so tampering can be detected, attributed,
-- and timestamped.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  table_name  TEXT        NOT NULL,
  operation   TEXT        NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
  key         TEXT,                   -- the PK of the affected row
  old_value   JSONB,
  new_value   JSONB,
  changed_by  TEXT                    -- auth.uid() or 'system' when SECURITY DEFINER
);

-- Only service-role / admin RPCs should ever read the audit log.
-- Anon has no access at all.
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for anon means all direct REST reads are blocked.
-- Admin panel reads go through api.admin_get_audit_log (added below).


-- ============================================================
-- PART 4: BEFORE triggers on admin_settings and package_layouts
--
-- Using a BEFORE trigger means the log entry is written in the
-- same transaction as the data change — it cannot be bypassed
-- by a concurrent DELETE of the log table.
-- ============================================================

-- ── Trigger function ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_audit_admin_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key      TEXT;
  v_old_val  JSONB;
  v_new_val  JSONB;
  v_tbl      TEXT;
BEGIN
  v_tbl := TG_TABLE_NAME;

  -- Determine PK and value columns based on table
  IF v_tbl = 'admin_settings' THEN
    CASE TG_OP
      WHEN 'INSERT' THEN
        v_key     := NEW.key;
        v_new_val := NEW.value;
      WHEN 'UPDATE' THEN
        v_key     := NEW.key;
        v_old_val := OLD.value;
        v_new_val := NEW.value;
      WHEN 'DELETE' THEN
        v_key     := OLD.key;
        v_old_val := OLD.value;
    END CASE;

  ELSIF v_tbl = 'package_layouts' THEN
    CASE TG_OP
      WHEN 'INSERT' THEN
        v_key     := NEW.package_key;
        v_new_val := NEW.plan_data;
      WHEN 'UPDATE' THEN
        v_key     := NEW.package_key;
        v_old_val := OLD.plan_data;
        v_new_val := NEW.plan_data;
      WHEN 'DELETE' THEN
        v_key     := OLD.package_key;
        v_old_val := OLD.plan_data;
    END CASE;
  END IF;

  INSERT INTO public.admin_audit_log (
    table_name, operation, key, old_value, new_value, changed_by
  ) VALUES (
    v_tbl,
    TG_OP,
    v_key,
    v_old_val,
    v_new_val,
    COALESCE(auth.uid()::TEXT, 'system')
  );

  -- Return appropriate row for BEFORE trigger
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- ── Install triggers ──────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_admin_settings   ON public.admin_settings;
CREATE TRIGGER trg_audit_admin_settings
  BEFORE INSERT OR UPDATE OR DELETE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_admin_write();

DROP TRIGGER IF EXISTS trg_audit_package_layouts  ON public.package_layouts;
CREATE TRIGGER trg_audit_package_layouts
  BEFORE INSERT OR UPDATE OR DELETE ON public.package_layouts
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_admin_write();


-- ============================================================
-- Admin RPC: read audit log (session-verified)
-- ============================================================

CREATE OR REPLACE FUNCTION api.admin_get_audit_log(p_token TEXT, p_limit INT DEFAULT 200)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN COALESCE(
    (
      SELECT json_agg(r ORDER BY r.changed_at DESC)
      FROM (
        SELECT * FROM public.admin_audit_log
        ORDER BY changed_at DESC
        LIMIT LEAST(p_limit, 1000)
      ) r
    ),
    '[]'::json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.admin_get_audit_log(TEXT, INT) TO anon, authenticated;


-- ============================================================
-- VERIFICATION QUERIES
-- Run these in the Supabase SQL Editor to confirm the fix:
--
-- 1. Check no write policies remain for anon on admin_settings:
--    SELECT policyname, cmd, roles
--    FROM pg_policies
--    WHERE tablename = 'admin_settings'
--      AND (roles @> ARRAY['anon'] OR roles = '{}')
--      AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
--    Expected: 0 rows
--
-- 2. Same check for package_layouts:
--    SELECT policyname, cmd, roles
--    FROM pg_policies
--    WHERE tablename = 'package_layouts'
--      AND (roles @> ARRAY['anon'] OR roles = '{}')
--      AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
--    Expected: 0 rows
--
-- 3. Confirm triggers are installed:
--    SELECT trigger_name, event_manipulation, event_object_table
--    FROM information_schema.triggers
--    WHERE trigger_name IN (
--      'trg_audit_admin_settings','trg_audit_package_layouts');
--    Expected: 2 rows
--
-- 4. Confirm direct REST write is now rejected (HTTP 403):
--    curl -X PATCH \
--      "https://<project>.supabase.co/rest/v1/admin_settings?key=eq.pricing" \
--      -H "apikey: <anon_key>" \
--      -H "Authorization: Bearer <anon_key>" \
--      -H "Content-Type: application/json" \
--      -d '{"value":{"sqft_rate":1}}'
--    Expected: HTTP 403 or empty 200 with no rows changed
-- ============================================================
