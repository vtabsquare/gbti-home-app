-- ============================================================
-- GBTI-WEB-05 Fix: Rate Limiting on Authentication Endpoints
-- CWE-307: Improper Restriction of Excessive Authentication Attempts
-- OWASP A07:2021 — Identification and Authentication Failures
-- CVSS 7.5 HIGH
--
-- What this does:
--   1. Creates auth_rate_limits table to track attempt counts
--   2. Adds failed_otp_attempts + locked_until to admin_users
--   3. Enforces 5-attempt / 15-minute sliding window per email
--   4. Locks admin accounts for 30 minutes after 10 failed OTP attempts
--   5. Limits OTP send requests to 3 per 15 minutes per email
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- STEP 1: Auth rate-limit attempt log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   TEXT        NOT NULL,
  action       TEXT        NOT NULL,
  attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_lookup
  ON public.auth_rate_limits (identifier, action, attempt_at);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: Add lockout columns to admin_users
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'failed_otp_attempts'
  ) THEN
    ALTER TABLE public.admin_users
      ADD COLUMN failed_otp_attempts INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'locked_until'
  ) THEN
    ALTER TABLE public.admin_users
      ADD COLUMN locked_until TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================================
-- STEP 3: Helper — is_rate_limited(identifier, action, max, window_minutes)
-- ============================================================

CREATE OR REPLACE FUNCTION is_rate_limited(
  p_identifier    TEXT,
  p_action        TEXT,
  p_max_attempts  INT DEFAULT 5,
  p_window_minutes INT DEFAULT 15
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO   v_count
  FROM   public.auth_rate_limits
  WHERE  identifier = LOWER(TRIM(p_identifier))
    AND  action     = p_action
    AND  attempt_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  RETURN v_count >= p_max_attempts;
END;
$$;

-- ============================================================
-- STEP 4: Helper — record_auth_attempt (logs + prunes old rows)
-- ============================================================

CREATE OR REPLACE FUNCTION record_auth_attempt(
  p_identifier TEXT,
  p_action     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.auth_rate_limits (identifier, action, attempt_at)
  VALUES (LOWER(TRIM(p_identifier)), p_action, NOW());

  DELETE FROM public.auth_rate_limits
  WHERE attempt_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- ============================================================
-- STEP 5: send_admin_login_otp — rate-limited (3 / 15 min)
-- Returns 'RATE_LIMITED' | 'LOCKED' | NULL (unknown email) | plaintext OTP
-- ============================================================

CREATE OR REPLACE FUNCTION send_admin_login_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT;
  v_salt TEXT;
  v_hash TEXT;
  v_found BOOLEAN;
  v_user  public.admin_users%ROWTYPE;
BEGIN
  IF is_rate_limited(p_email, 'send_admin_otp', 3, 15) THEN
    RETURN 'RATE_LIMITED';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.admin_users WHERE email = LOWER(TRIM(p_email))
  ) INTO v_found;

  IF NOT v_found THEN
    PERFORM record_auth_attempt(p_email, 'send_admin_otp');
    RETURN NULL;
  END IF;

  SELECT * INTO v_user
  FROM public.admin_users WHERE email = LOWER(TRIM(p_email));

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > NOW() THEN
    RETURN 'LOCKED';
  END IF;

  PERFORM record_auth_attempt(p_email, 'send_admin_otp');

  v_code := LPAD(
    (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::TEXT,
    6, '0'
  );

  v_salt := encode(gen_random_bytes(16), 'hex');
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  UPDATE public.admin_users
  SET reset_code             = NULL,
      reset_code_expires_at  = NOW() + INTERVAL '10 minutes',
      otp_hash               = v_hash,
      otp_salt               = v_salt,
      updated_at             = NOW()
  WHERE email = LOWER(TRIM(p_email));

  RETURN v_code;
END;
$$;

-- ============================================================
-- STEP 6: verify_admin_login_otp — rate-limited + account lockout
-- Returns NULL on failure, JSON on success, JSON with error key if rate-limited/locked
-- ============================================================

CREATE OR REPLACE FUNCTION verify_admin_login_otp(p_email TEXT, p_otp TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user           public.admin_users%ROWTYPE;
  v_submitted_hash TEXT;
  v_session_token  TEXT;
  v_new_fails      INTEGER;
BEGIN
  IF is_rate_limited(p_email, 'verify_admin_otp', 5, 15) THEN
    RETURN json_build_object(
      'error',   'rate_limited',
      'message', 'Too many failed attempts. Please wait 15 minutes before trying again.'
    );
  END IF;

  SELECT * INTO v_user
  FROM public.admin_users
  WHERE email = LOWER(TRIM(p_email))
    AND reset_code_expires_at > NOW()
    AND otp_hash IS NOT NULL
    AND otp_salt IS NOT NULL;

  IF v_user.id IS NULL THEN
    PERFORM record_auth_attempt(p_email, 'verify_admin_otp');
    RETURN NULL;
  END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > NOW() THEN
    RETURN json_build_object(
      'error',       'locked',
      'message',     'Account temporarily locked due to too many failed attempts. Try again later.',
      'locked_until', v_user.locked_until
    );
  END IF;

  PERFORM record_auth_attempt(p_email, 'verify_admin_otp');

  v_submitted_hash := encode(digest(p_otp || v_user.otp_salt, 'sha256'), 'hex');

  IF v_submitted_hash != v_user.otp_hash THEN
    v_new_fails := v_user.failed_otp_attempts + 1;

    UPDATE public.admin_users
    SET failed_otp_attempts = v_new_fails,
        locked_until        = CASE
          WHEN v_new_fails >= 10 THEN NOW() + INTERVAL '30 minutes'
          ELSE locked_until
        END,
        updated_at          = NOW()
    WHERE id = v_user.id;

    RETURN NULL;
  END IF;

  v_session_token := encode(gen_random_bytes(32), 'hex');

  UPDATE public.admin_users
  SET otp_hash            = NULL,
      otp_salt            = NULL,
      reset_code          = NULL,
      reset_code_expires_at = NULL,
      session_token       = v_session_token,
      session_expires_at  = NOW() + INTERVAL '24 hours',
      failed_otp_attempts = 0,
      locked_until        = NULL,
      updated_at          = NOW()
  WHERE id = v_user.id;

  RETURN json_build_object(
    'id',           v_user.id,
    'email',        v_user.email,
    'display_name', v_user.display_name,
    'session_token', v_session_token
  );
END;
$$;

-- ============================================================
-- STEP 7: store_visitor_otp — rate-limited (3 / 15 min)
-- ============================================================

CREATE OR REPLACE FUNCTION store_visitor_otp(p_email TEXT)
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

  v_code := LPAD(
    (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::TEXT,
    6, '0'
  );

  v_salt := encode(gen_random_bytes(16), 'hex');
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  DELETE FROM public.visitor_otps WHERE email = LOWER(TRIM(p_email));

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
-- STEP 8: verify_visitor_otp — rate-limited (5 / 15 min)
-- ============================================================

CREATE OR REPLACE FUNCTION verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record         public.visitor_otps%ROWTYPE;
  v_submitted_hash TEXT;
BEGIN
  IF is_rate_limited(p_email, 'verify_visitor_otp', 5, 15) THEN
    RETURN FALSE;
  END IF;

  PERFORM record_auth_attempt(p_email, 'verify_visitor_otp');

  SELECT * INTO v_record
  FROM public.visitor_otps
  WHERE email    = LOWER(TRIM(p_email))
    AND expires_at > NOW()
    AND otp_hash IS NOT NULL
    AND otp_salt IS NOT NULL;

  IF v_record.id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_submitted_hash := encode(digest(p_otp || v_record.otp_salt, 'sha256'), 'hex');

  IF v_submitted_hash != v_record.otp_hash THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.visitor_otps WHERE id = v_record.id;
  RETURN TRUE;
END;
$$;

-- ============================================================
-- DONE — Apply in Supabase SQL Editor, then re-run the test
-- script: security-tests/test-brute-force-GBTI-WEB-05.ps1
--
-- ALSO required (Supabase Dashboard):
--   Authentication > Rate Limits > Sign-in: 5 attempts / 15 min / IP
--   Authentication > Rate Limits > OTP:     3 requests  / 15 min / IP
--   Authentication > CAPTCHA: enable hCaptcha or Cloudflare Turnstile
-- ============================================================
