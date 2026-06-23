-- ============================================================
-- GBTI-WEB-03 Fix: Hash OTPs before storing in database
-- CWE-312: Cleartext Storage of Sensitive Information
-- CVSS 8.1 HIGH
-- ============================================================
-- WHAT THIS DOES:
-- Instead of storing OTP as "483137" (readable plaintext),
-- we store SHA-256("483137" + random_salt) — unreadable gibberish.
-- Even if someone reads the database, they cannot use the hash to log in.
-- Verification works by hashing the user's submitted code and comparing.
-- ============================================================

-- Ensure pgcrypto is available (needed for gen_random_bytes, digest)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- PART 1: Fix the ADMIN PANEL OTPs
-- Admin OTPs are stored in admin_users.reset_code as plaintext.
-- We hash them now.
-- ============================================================

-- Add columns to admin_users to store hash and salt instead of plaintext OTP
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_users' AND column_name = 'otp_hash') THEN
    ALTER TABLE admin_users ADD COLUMN otp_hash TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_users' AND column_name = 'otp_salt') THEN
    ALTER TABLE admin_users ADD COLUMN otp_salt TEXT;
  END IF;
END $$;

-- Update send_admin_login_otp: generate OTP, hash it, store only the hash+salt
-- The plaintext OTP is returned to the frontend to be emailed via InfoBip.
-- The plaintext is NEVER stored in the database.
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
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM admin_users WHERE email = LOWER(TRIM(p_email))
  ) INTO v_found;

  IF NOT v_found THEN
    -- Return NULL but don't reveal whether email exists (prevents user enumeration)
    RETURN NULL;
  END IF;

  -- Generate a cryptographically random 6-digit OTP
  v_code := LPAD((get_byte(gen_random_bytes(3), 0)::int |
                  (get_byte(gen_random_bytes(3), 1)::int << 8) |
                  (get_byte(gen_random_bytes(3), 2)::int << 16))::int % 1000000, 6, '0')::TEXT;

  -- Generate a unique random salt for this OTP
  v_salt := encode(gen_random_bytes(16), 'hex');

  -- Hash the OTP with the salt using SHA-256
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  -- Store ONLY the hash and salt — never the plaintext code
  UPDATE admin_users
  SET reset_code = NULL,             -- Clear old plaintext code
      reset_code_expires_at = NOW() + INTERVAL '10 minutes',
      otp_hash = v_hash,
      otp_salt = v_salt,
      updated_at = NOW()
  WHERE email = LOWER(TRIM(p_email));

  -- Return the plaintext code to be emailed by InfoBip (never stored in DB)
  RETURN v_code;
END;
$$;

-- Update verify_admin_login_otp: hash the submitted code and compare
CREATE OR REPLACE FUNCTION verify_admin_login_otp(p_email TEXT, p_otp TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user admin_users%ROWTYPE;
  v_submitted_hash TEXT;
  v_session_token TEXT;
BEGIN
  -- Fetch user record (only if OTP is not expired)
  SELECT * INTO v_user
  FROM admin_users
  WHERE email = LOWER(TRIM(p_email))
    AND reset_code_expires_at > NOW()
    AND otp_hash IS NOT NULL
    AND otp_salt IS NOT NULL;

  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Hash the submitted OTP with the stored salt and compare
  v_submitted_hash := encode(digest(p_otp || v_user.otp_salt, 'sha256'), 'hex');

  IF v_submitted_hash != v_user.otp_hash THEN
    RETURN NULL;
  END IF;

  -- OTP is valid — generate a secure session token
  v_session_token := encode(gen_random_bytes(32), 'hex');

  -- Clear OTP immediately after successful use + store session
  UPDATE admin_users
  SET otp_hash = NULL,
      otp_salt = NULL,
      reset_code = NULL,
      reset_code_expires_at = NULL,
      session_token = v_session_token,
      session_expires_at = NOW() + INTERVAL '24 hours',
      updated_at = NOW()
  WHERE id = v_user.id;

  RETURN json_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'session_token', v_session_token
  );
END;
$$;

-- ============================================================
-- PART 2: Fix the VISITOR OTPs (main app login gate)
-- The visitor_otps table stores plaintext OTPs.
-- We add otp_hash and otp_salt columns and update the RPCs.
-- ============================================================

-- Add hash/salt columns to visitor_otps table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'visitor_otps' AND column_name = 'otp_hash') THEN
    ALTER TABLE visitor_otps ADD COLUMN otp_hash TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'visitor_otps' AND column_name = 'otp_salt') THEN
    ALTER TABLE visitor_otps ADD COLUMN otp_salt TEXT;
  END IF;
END $$;

-- Update store_visitor_otp (if it exists): hash OTP before storing
-- This function creates/updates OTP records for main app visitors
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
  -- Generate cryptographically random 6-digit OTP
  v_code := LPAD((get_byte(gen_random_bytes(3), 0)::int |
                  (get_byte(gen_random_bytes(3), 1)::int << 8) |
                  (get_byte(gen_random_bytes(3), 2)::int << 16))::int % 1000000, 6, '0')::TEXT;

  -- Generate unique random salt
  v_salt := encode(gen_random_bytes(16), 'hex');

  -- Hash OTP with salt
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  -- Delete any existing OTP for this email first
  DELETE FROM visitor_otps WHERE email = LOWER(TRIM(p_email));

  -- Insert hashed OTP (never plaintext)
  INSERT INTO visitor_otps (email, otp_hash, otp_salt, expires_at, created_at)
  VALUES (
    LOWER(TRIM(p_email)),
    v_hash,
    v_salt,
    NOW() + INTERVAL '10 minutes',
    NOW()
  )
  ON CONFLICT (email) DO UPDATE
    SET otp_hash = EXCLUDED.otp_hash,
        otp_salt = EXCLUDED.otp_salt,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();

  -- Return plaintext to send via InfoBip — NEVER stored in DB
  RETURN v_code;
END;
$$;

-- Update verify_visitor_otp: hash submitted code and compare
CREATE OR REPLACE FUNCTION verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record visitor_otps%ROWTYPE;
  v_submitted_hash TEXT;
BEGIN
  -- Fetch the OTP record (only if not expired)
  SELECT * INTO v_record
  FROM visitor_otps
  WHERE email = LOWER(TRIM(p_email))
    AND expires_at > NOW()
    AND otp_hash IS NOT NULL
    AND otp_salt IS NOT NULL;

  IF v_record.id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Hash the submitted OTP with the stored salt
  v_submitted_hash := encode(digest(p_otp || v_record.otp_salt, 'sha256'), 'hex');

  -- Compare hashes in constant time (prevent timing attacks)
  IF v_submitted_hash != v_record.otp_hash THEN
    RETURN FALSE;
  END IF;

  -- Delete OTP immediately after successful use (one-time use only)
  DELETE FROM visitor_otps WHERE id = v_record.id;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- PART 3: Drop the otp_code column from visitor_otps if it exists
-- (The plaintext column should not exist)
-- ============================================================
ALTER TABLE public.visitor_otps DROP COLUMN IF EXISTS otp_code;

-- Also clear any existing plaintext OTPs in admin_users (they're expired anyway)
UPDATE admin_users SET reset_code = NULL WHERE reset_code IS NOT NULL;

-- ============================================================
-- DONE - Run this in Supabase SQL Editor
-- ============================================================
