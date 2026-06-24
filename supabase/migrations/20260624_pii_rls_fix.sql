-- ============================================================
-- GBTI-WEB-04 Fix: Unauthenticated Access to Customer PII
-- CWE-200 / CWE-284 | OWASP A02:2021 | CVSS 7.5 HIGH
--
-- What this does:
--   1. Removes anon SELECT/DELETE/UPDATE on the leads table
--      (anon INSERT kept for visitor form submissions)
--   2. Re-enables RLS on visitor_sessions (was disabled in setup)
--   3. Re-enables RLS on visitor_otps  (was disabled in setup)
--   4. Data minimisation: truncates stored user_agent strings
--   5. Updates store_visitor_session to not store full UA string
--
-- Admin reads/writes continue to work via admin-api Edge Function
-- which uses the SERVICE ROLE KEY and verifies session token.
-- ============================================================

-- ============================================================
-- STEP 1: Remove over-permissive anon policies on leads
-- These were added by 20260623_fix_rls_security.sql for the
-- admin panel to work, but the admin panel must use the Edge
-- Function (service role) instead of direct anon key access.
-- ============================================================

DROP POLICY IF EXISTS "Admin can read leads"   ON public.leads;
DROP POLICY IF EXISTS "Admin can delete leads" ON public.leads;
DROP POLICY IF EXISTS "Admin can update leads" ON public.leads;

-- Keep: "Public can insert leads" (anon INSERT — needed for the visitor form)

-- Confirm RLS is still enabled
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: Lock down visitor_sessions
-- The initial setup script (supabase_visitor_setup.sql) ran
--   ALTER TABLE visitor_sessions DISABLE ROW LEVEL SECURITY;
-- We re-enable it here. The store_visitor_session() SECURITY
-- DEFINER function still works — it bypasses RLS by design.
-- ============================================================

ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;

-- Ensure no stale anon SELECT policy exists on visitor_sessions
DROP POLICY IF EXISTS "Anyone can read visitor sessions"     ON public.visitor_sessions;
DROP POLICY IF EXISTS "Public can read visitor sessions"     ON public.visitor_sessions;
DROP POLICY IF EXISTS "Admin can read visitor sessions"      ON public.visitor_sessions;
DROP POLICY IF EXISTS "Anon can read visitor sessions"       ON public.visitor_sessions;

-- No SELECT policy for anon = all direct REST reads blocked.
-- Writes go through store_visitor_session() SECURITY DEFINER RPC.

-- ============================================================
-- STEP 3: Lock down visitor_otps (also had RLS disabled)
-- ============================================================

ALTER TABLE public.visitor_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read visitor otps"  ON public.visitor_otps;
DROP POLICY IF EXISTS "Anyone can insert visitor otps" ON public.visitor_otps;
DROP POLICY IF EXISTS "Public can read visitor otps"  ON public.visitor_otps;

-- No direct anon access. All OTP operations go through
-- store_visitor_otp() and verify_visitor_otp() SECURITY DEFINER RPCs.

-- ============================================================
-- STEP 4: Data minimisation — truncate existing user_agent
-- Amber: "remove full User-Agent strings and screen dimensions
-- from visitor_sessions unless a documented business purpose
-- requires them."
-- We truncate to 80 chars (enough for browser family, not enough
-- to fingerprint a specific user).
-- ============================================================

UPDATE public.visitor_sessions
SET user_agent = CASE
    WHEN user_agent IS NULL           THEN NULL
    WHEN LENGTH(user_agent) <= 80     THEN user_agent
    ELSE SUBSTRING(user_agent, 1, 80) || ' [truncated]'
END
WHERE user_agent IS NOT NULL AND LENGTH(user_agent) > 80;

-- ============================================================
-- STEP 5: Update store_visitor_session to truncate UA on insert
-- Keeps function signature identical (no frontend changes needed)
-- Drop all overloaded versions first to avoid 'not unique' error
-- ============================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT oid::regprocedure::text AS sig
        FROM pg_proc
        WHERE proname = 'store_visitor_session'
          AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION store_visitor_session(
  p_email            TEXT,
  p_device_type      TEXT,
  p_browser          TEXT,
  p_os               TEXT,
  p_screen_width     INTEGER,
  p_screen_height    INTEGER,
  p_user_agent       TEXT,
  p_full_name        TEXT    DEFAULT NULL,
  p_phone            TEXT    DEFAULT NULL,
  p_project_timeline TEXT    DEFAULT NULL,
  p_preferred_branch TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id           UUID;
  v_ua_truncated TEXT;
BEGIN
  -- Truncate user_agent to 80 chars maximum (data minimisation - GBTI-WEB-04)
  v_ua_truncated := CASE
    WHEN p_user_agent IS NULL         THEN NULL
    WHEN LENGTH(p_user_agent) <= 80   THEN p_user_agent
    ELSE SUBSTRING(p_user_agent, 1, 80) || ' [truncated]'
  END;

  INSERT INTO visitor_sessions (
    email, device_type, browser, os,
    screen_width,
    screen_height,
    user_agent,
    full_name, phone, project_timeline, preferred_branch
  )
  VALUES (
    LOWER(TRIM(p_email)),
    p_device_type,
    p_browser,
    p_os,
    p_screen_width,
    NULL,              -- screen_height omitted (unnecessary PII per GBTI-WEB-04)
    v_ua_truncated,    -- truncated, not full string
    p_full_name,
    p_phone,
    p_project_timeline,
    p_preferred_branch
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- STEP 6: Grant execute permission so anon can call the RPC
-- (already set in prior migrations but ensure it here)
-- ============================================================
GRANT EXECUTE ON FUNCTION store_visitor_session TO anon;
GRANT EXECUTE ON FUNCTION store_visitor_otp     TO anon;
GRANT EXECUTE ON FUNCTION verify_visitor_otp    TO anon;

-- ============================================================
-- VERIFICATION QUERIES (run these to confirm fix)
-- ============================================================

-- Check remaining policies on leads:
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'leads';
-- Expected: only "Public can insert leads" (INSERT, anon)
--
-- Check RLS status on critical tables:
-- SELECT tablename, rowsecurity FROM pg_tables
--   WHERE tablename IN ('leads','visitor_sessions','visitor_otps');
-- Expected: rowsecurity = TRUE for all three
--
-- Test anon access (should return empty array, not data):
-- Run the PowerShell test: security-tests/test-pii-access-GBTI-WEB-04.ps1
-- ============================================================
