-- ============================================================
-- HOTFIX: Fix LPAD type error in OTP generation functions
-- Error: function lpad(integer, integer, unknown) does not exist
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fix send_admin_login_otp (used by Admin Panel login)
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
    RETURN NULL;
  END IF;

  -- Generate cryptographically random 6-digit OTP
  -- Cast the integer result to TEXT before passing to LPAD
  v_code := LPAD(
    (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::TEXT,
    6, '0'
  );

  -- Generate unique random salt
  v_salt := encode(gen_random_bytes(16), 'hex');

  -- Hash OTP with salt using SHA-256 (never store plaintext)
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  -- Store only hash and salt — NOT the plaintext code
  UPDATE admin_users
  SET reset_code = NULL,
      reset_code_expires_at = NOW() + INTERVAL '10 minutes',
      otp_hash = v_hash,
      otp_salt = v_salt,
      updated_at = NOW()
  WHERE email = LOWER(TRIM(p_email));

  -- Return plaintext to be emailed — NEVER stored in DB
  RETURN v_code;
END;
$$;

-- Fix store_visitor_otp (used by main app visitor gate)
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
  -- Generate cryptographically random 6-digit OTP (TEXT cast fix)
  v_code := LPAD(
    (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::TEXT,
    6, '0'
  );

  v_salt := encode(gen_random_bytes(16), 'hex');
  v_hash := encode(digest(v_code || v_salt, 'sha256'), 'hex');

  DELETE FROM visitor_otps WHERE email = LOWER(TRIM(p_email));

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

  RETURN v_code;
END;
$$;

-- ============================================================
-- DONE - Run this in Supabase SQL Editor
-- ============================================================
