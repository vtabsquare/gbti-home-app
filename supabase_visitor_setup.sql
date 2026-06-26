-- ============================================================
-- GBTI Home Builder — Visitor Session & OTP Setup
-- Run this in your Supabase Dashboard SQL Editor
-- ============================================================

-- Enable pgcrypto if not already
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Temporary OTP storage for visitor email verification
CREATE TABLE IF NOT EXISTS visitor_otps (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visitor_otps DISABLE ROW LEVEL SECURITY;

-- Permanent store for verified visitor sessions
CREATE TABLE IF NOT EXISTS visitor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  user_agent TEXT,
  full_name TEXT,
  phone TEXT,
  project_timeline TEXT,
  preferred_branch TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visitor_sessions DISABLE ROW LEVEL SECURITY;

-- ─── RPC Functions ───────────────────────────────────────────

-- Generate and store a 6-digit OTP for a visitor email
CREATE OR REPLACE FUNCTION send_visitor_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT;
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  -- Generate cryptographically random 6-digit OTP
  v_code := LPAD((get_byte(gen_random_bytes(3), 0)::int |
                  (get_byte(gen_random_bytes(3), 1)::int << 8) |
                  (get_byte(gen_random_bytes(3), 2)::int << 16))::int % 1000000, 6, '0')::TEXT;

  -- Generate unique random salt
  v_salt := encode(gen_random_bytes(16), 'hex');

  -- Hash OTP with salt
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  INSERT INTO visitor_otps (email, otp_hash, otp_salt, expires_at)
  VALUES (LOWER(TRIM(p_email)), v_hash, v_salt, NOW() + INTERVAL '10 minutes')
  ON CONFLICT (email) DO UPDATE SET
    otp_hash = EXCLUDED.otp_hash,
    otp_salt = EXCLUDED.otp_salt,
    expires_at = EXCLUDED.expires_at,
    created_at = NOW();

  RETURN v_code;
END;
$$;

-- Verify visitor OTP
-- SCR-GBTI-03 Fix: Uses atomic DELETE...RETURNING to eliminate TOCTOU race condition.
-- Only the caller whose DELETE actually removes the row receives TRUE;
-- any concurrent call with the same OTP gets FALSE.
CREATE OR REPLACE FUNCTION verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted        INT;
  v_record         visitor_otps%ROWTYPE;
  v_submitted_hash TEXT;
BEGIN
  -- Fetch the OTP record (non-locking read to get the salt for hashing)
  SELECT * INTO v_record
  FROM visitor_otps
  WHERE email      = LOWER(TRIM(p_email))
    AND expires_at > NOW()
    AND otp_hash   IS NOT NULL
    AND otp_salt   IS NOT NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Hash the submitted OTP with the stored salt
  v_submitted_hash := encode(digest(p_otp || v_record.otp_salt, 'sha256'), 'hex');

  IF v_submitted_hash != v_record.otp_hash THEN
    RETURN FALSE;
  END IF;

  -- Atomically consume the OTP row — eliminates TOCTOU window.
  -- Uses email (the PRIMARY KEY) + otp_hash re-check for atomic guarantee.
  -- Only one concurrent caller will delete this row; all others get ROW_COUNT=0.
  DELETE FROM visitor_otps
  WHERE email      = LOWER(TRIM(p_email))
    AND expires_at > NOW()
    AND otp_hash   = v_record.otp_hash;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$$;

-- Store verified visitor session with device info
CREATE OR REPLACE FUNCTION store_visitor_session(
  p_email TEXT,
  p_device_type TEXT,
  p_browser TEXT,
  p_os TEXT,
  p_screen_width INTEGER,
  p_screen_height INTEGER,
  p_user_agent TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_project_timeline TEXT DEFAULT NULL,
  p_preferred_branch TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO visitor_sessions (email, device_type, browser, os, screen_width, screen_height, user_agent, full_name, phone, project_timeline, preferred_branch)
  VALUES (LOWER(TRIM(p_email)), p_device_type, p_browser, p_os, p_screen_width, p_screen_height, p_user_agent, p_full_name, p_phone, p_project_timeline, p_preferred_branch)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- DONE! visitor_otps and visitor_sessions tables are ready.
-- ============================================================
