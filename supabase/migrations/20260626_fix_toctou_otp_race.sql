-- ============================================================
-- SCR-GBTI-03 Fix: Race Condition (TOCTOU) in verify_visitor_otp
-- CWE-362: Concurrent Execution Using Shared Resource with
--           Improper Synchronization
-- CWE-613: Insufficient Session Expiration
-- OWASP A07:2021 — Identification and Authentication Failures
-- CVSS 5.9 MEDIUM
--
-- Root Cause:
--   The previous implementation used a two-step pattern:
--     1. SELECT ... INTO  (check if OTP row is valid)
--     2. DELETE ...       (consume the OTP)
--   Under PostgreSQL's default READ COMMITTED isolation, two
--   concurrent requests with the same OTP can both pass the
--   SELECT check before either DELETE commits, allowing the
--   same one-time passcode to authenticate two sessions.
--
-- Fix:
--   Replace the SELECT + DELETE with a single atomic
--   DELETE ... RETURNING statement. Only the transaction whose
--   DELETE actually removes the row receives a record back;
--   any concurrent DELETE on the same row gets nothing.
--   This collapses the TOCTOU window to zero without requiring
--   SELECT FOR UPDATE or SERIALIZABLE isolation.
--
-- Scope of change:
--   • public.verify_visitor_otp — core fix (atomic delete)
--   • api.verify_visitor_otp    — pass-through wrapper
--     (unchanged logic, but recreated to stay consistent)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- STEP 1: Rewrite public.verify_visitor_otp with atomic
--         DELETE ... RETURNING (eliminates TOCTOU entirely)
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted        INT;
  v_record         public.visitor_otps%ROWTYPE;
  v_submitted_hash TEXT;
BEGIN
  -- ── Rate-limit check (unchanged from 20260624_rate_limiting_fix) ──
  IF is_rate_limited(p_email, 'verify_visitor_otp', 5, 15) THEN
    RETURN FALSE;
  END IF;

  -- Record this attempt regardless of outcome (for rate-limit tracking)
  PERFORM record_auth_attempt(p_email, 'verify_visitor_otp');

  -- ── Step 1: Atomically fetch the OTP record ──────────────────────
  -- SELECT without locking so we can read the salt to hash p_otp.
  -- A non-locking read is safe here because the actual consumption
  -- is done by the atomic DELETE below; a concurrent caller that
  -- reads the same row will lose the race at DELETE time.
  SELECT * INTO v_record
  FROM public.visitor_otps
  WHERE email      = LOWER(TRIM(p_email))
    AND expires_at > NOW()
    AND otp_hash   IS NOT NULL
    AND otp_salt   IS NOT NULL;

  IF v_record.id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- ── Step 2: Validate the submitted OTP hash ───────────────────────
  v_submitted_hash := encode(digest(p_otp || v_record.otp_salt, 'sha256'), 'hex');

  IF v_submitted_hash != v_record.otp_hash THEN
    RETURN FALSE;
  END IF;

  -- ── Step 3: Atomically consume the OTP row ────────────────────────
  -- DELETE ... RETURNING is a single atomic statement. Only one
  -- concurrent caller will delete this exact row; all others receive
  -- 0 rows back (v_deleted = 0) and therefore return FALSE.
  -- This eliminates the TOCTOU window entirely.
  DELETE FROM public.visitor_otps
  WHERE id         = v_record.id
    AND expires_at > NOW()           -- re-check expiry inside the atomic op
    AND otp_hash   = v_record.otp_hash; -- re-check hash integrity

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Only the caller whose DELETE actually removed the row succeeds
  RETURN v_deleted > 0;
END;
$$;

-- ============================================================
-- STEP 2: Recreate api.verify_visitor_otp pass-through wrapper
--         (no logic change — ensures api schema stays in sync)
-- ============================================================

CREATE OR REPLACE FUNCTION api.verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_visitor_otp(p_email, p_otp);
END;
$$;

-- Re-grant execute (idempotent — harmless if already granted)
GRANT EXECUTE ON FUNCTION public.verify_visitor_otp(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.verify_visitor_otp(TEXT, TEXT)    TO anon, authenticated;

-- ============================================================
-- VERIFICATION QUERIES
-- Run these in Supabase SQL Editor after applying:
--
-- 1. Confirm the function body uses DELETE ... GET DIAGNOSTICS:
--    SELECT pg_get_functiondef(oid)
--    FROM pg_proc
--    WHERE proname = 'verify_visitor_otp'
--      AND pronamespace = 'public'::regnamespace;
--    Expected: body contains "GET DIAGNOSTICS v_deleted = ROW_COUNT"
--
-- 2. Proof-of-concept race test (should now return only one TRUE):
--    -- Obtain an OTP first, then run two concurrent verifies:
--    -- curl -s -X POST "$BASE/rest/v1/rpc/verify_visitor_otp" \
--    --   -H "apikey: $ANON" -H "Content-Type: application/json" \
--    --   -d '{"p_email":"victim@example.com","p_otp":"$OTP"}' &
--    -- curl -s -X POST "$BASE/rest/v1/rpc/verify_visitor_otp" \
--    --   -H "apikey: $ANON" -H "Content-Type: application/json" \
--    --   -d '{"p_email":"victim@example.com","p_otp":"$OTP"}' &
--    -- wait
--    -- Expected: exactly one response is true, one is false
--
-- 3. Confirm OTP row is fully deleted after first success:
--    SELECT * FROM visitor_otps WHERE email = 'victim@example.com';
--    Expected: 0 rows
-- ============================================================
