-- ============================================================
-- SCR-GBTI-03 Hotfix: Correct visitor_otps primary key reference
-- and store_visitor_otp LPAD type cast
--
-- Issue 1: verify_visitor_otp — "record v_record has no field id"
--   Root cause: visitor_otps table was created with email TEXT PRIMARY KEY
--   (no id UUID column). The TOCTOU fix migration referenced v_record.id
--   which does not exist. Fix: use email as the atomic DELETE key.
--
-- Issue 2: store_visitor_otp — "function lpad(integer, integer, unknown)"
--   Root cause: LPAD expression produces an intermediate integer that
--   needs an explicit ::TEXT cast before the 6-character pad target.
--   Fix: wrap result in explicit ::TEXT cast.
--
-- Both functions are recreated here in their correct final forms.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- STEP 1: Add id column to visitor_otps if it doesn't exist
-- This makes the table consistent with what the rate_limiting_fix
-- migration assumed, and also enables more precise row-level DELETEs.
-- ============================================================

DO $$
BEGIN
  -- Add id UUID column if absent
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'visitor_otps' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.visitor_otps
      ADD COLUMN id UUID DEFAULT gen_random_uuid();

    -- Backfill any existing rows
    UPDATE public.visitor_otps SET id = gen_random_uuid() WHERE id IS NULL;

    -- Make it NOT NULL now that it's populated
    ALTER TABLE public.visitor_otps ALTER COLUMN id SET NOT NULL;
  END IF;
END $$;

-- ============================================================
-- STEP 2: Fix public.store_visitor_otp — correct LPAD type cast
-- The expression produces an integer that must be cast to TEXT
-- before LPAD can pad it. Use explicit ::TEXT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.store_visitor_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT;
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  IF is_rate_limited(p_email, 'send_visitor_otp', 3, 15) THEN
    RETURN 'RATE_LIMITED';
  END IF;

  PERFORM record_auth_attempt(p_email, 'send_visitor_otp');

  -- Explicit ::TEXT cast fixes the LPAD(integer, integer, unknown) error
  v_code := LPAD(
    (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::TEXT,
    6, '0'
  );

  v_salt := encode(gen_random_bytes(16), 'hex');
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  INSERT INTO public.visitor_otps (email, otp_hash, otp_salt, expires_at, created_at)
  VALUES (
    LOWER(TRIM(p_email)),
    v_hash,
    v_salt,
    NOW() + INTERVAL '10 minutes',
    NOW()
  )
  ON CONFLICT (email) DO UPDATE
    SET otp_hash   = EXCLUDED.otp_hash,
        otp_salt   = EXCLUDED.otp_salt,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();

  RETURN v_code;
END;
$$;

-- ============================================================
-- STEP 3: Fix public.verify_visitor_otp — use email as DELETE key
-- Since visitor_otps.email is the PRIMARY KEY, the atomic DELETE
-- must use WHERE email = ... not WHERE id = ..., but we add a
-- otp_hash re-check to keep the atomicity guarantee.
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
  v_norm_email     TEXT;
BEGIN
  v_norm_email := LOWER(TRIM(p_email));

  -- ── Rate-limit check ──────────────────────────────────────────────
  IF is_rate_limited(v_norm_email, 'verify_visitor_otp', 5, 15) THEN
    RETURN FALSE;
  END IF;

  -- Record this attempt (for rate-limit tracking)
  PERFORM record_auth_attempt(v_norm_email, 'verify_visitor_otp');

  -- ── Read the OTP record (non-locking, just to get the salt) ──────
  SELECT * INTO v_record
  FROM public.visitor_otps
  WHERE email      = v_norm_email
    AND expires_at > NOW()
    AND otp_hash   IS NOT NULL
    AND otp_salt   IS NOT NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- ── Validate the submitted OTP hash ───────────────────────────────
  v_submitted_hash := encode(digest(p_otp || v_record.otp_salt, 'sha256'), 'hex');

  IF v_submitted_hash != v_record.otp_hash THEN
    RETURN FALSE;
  END IF;

  -- ── Atomically consume the OTP row ────────────────────────────────
  -- DELETE WHERE email (PK) + re-check hash + re-check expiry.
  -- Only one concurrent caller can delete this row; others get ROW_COUNT=0.
  -- This eliminates the TOCTOU window (SCR-GBTI-03).
  DELETE FROM public.visitor_otps
  WHERE email      = v_norm_email
    AND otp_hash   = v_record.otp_hash
    AND expires_at > NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$$;

-- ============================================================
-- STEP 4: Re-sync api.* pass-through wrappers
-- ============================================================

CREATE OR REPLACE FUNCTION api.store_visitor_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.store_visitor_otp(p_email);
END;
$$;

CREATE OR REPLACE FUNCTION api.verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_visitor_otp(p_email, p_otp);
END;
$$;

-- Ensure grants are in place
GRANT EXECUTE ON FUNCTION public.store_visitor_otp(TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_visitor_otp(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.store_visitor_otp(TEXT)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.verify_visitor_otp(TEXT, TEXT)    TO anon, authenticated;

-- ============================================================
-- VERIFICATION (run after applying):
--
-- 1. Check visitor_otps has id column:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'visitor_otps' ORDER BY ordinal_position;
--
-- 2. Test store returns a 6-digit OTP (not an error):
--    SELECT api.store_visitor_otp('test@example.com');
--
-- 3. Test verify with wrong OTP returns false (not an error):
--    SELECT api.verify_visitor_otp('test@example.com', '000000');
-- ============================================================
