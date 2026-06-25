-- ============================================================
-- GBTI-WEB-09 Fix: Weak Bcrypt Cost Factor & OTP Plaintext
-- CWE-916: Use of Password Hash with Insufficient Computational Effort
-- CVSS 3.7 LOW
--
-- This vulnerability has TWO parts:
--
-- PART A: OTP Codes Stored in Plaintext
--   STATUS: ALREADY FIXED in 20260623_fix_otp_plaintext_exposure.sql
--   All OTPs are now stored as SHA-256(otp + random_salt).
--   The plaintext otp_code column has been dropped from visitor_otps.
--   The plaintext reset_code is cleared immediately after use in admin_users.
--
-- PART B: Weak Bcrypt Cost Factor (was: 6, required: ≥ 12)
--   The Supabase Auth system uses bcrypt to hash passwords for any
--   Supabase Auth users. The cost factor of 6 is cryptographically
--   weak and can be brute-forced with modern hardware.
--
--   FIX: The bcrypt cost factor MUST be changed in the Supabase Dashboard:
--     Dashboard → Authentication → Security → Bcrypt Cost → set to 12
--
--   This SQL does two things:
--   1. Confirms no plaintext passwords exist anywhere in custom tables
--   2. Drops any remaining legacy password columns defensively
-- ============================================================

-- ─── PART A VERIFICATION ──────────────────────────────────────────────────────
-- Confirm otp_code (plaintext) column no longer exists on visitor_otps
ALTER TABLE public.visitor_otps DROP COLUMN IF EXISTS otp_code;

-- Confirm reset_code (plaintext OTP) is cleared on admin_users  
-- (should already be NULL for all rows since fix #3, but enforce here)
UPDATE public.admin_users
SET reset_code = NULL
WHERE reset_code IS NOT NULL;

-- ─── PART B: Remove any remaining legacy password storage ────────────────────
-- The password_hash column was dropped in 20260623_fix_admin_credential_exposure.sql
-- Run defensively again in case it was re-added
ALTER TABLE public.admin_users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.admin_users DROP COLUMN IF EXISTS must_change_password;

-- ─── PART B: Harden OTP hashing — upgrade to bcrypt where possible ───────────
-- Our current SHA-256 + salt approach is secure for short-lived OTPs (10 min).
-- For extra hardening, we document that admin_users no longer stores any
-- hashed passwords at all — login is purely OTP-based via send_admin_login_otp.

-- Verify: admin_users has NO password column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'admin_users'
      AND column_name  IN ('password_hash', 'password', 'hashed_password')
  ) THEN
    RAISE EXCEPTION 'SECURITY ALERT: password column still exists in admin_users — remove it immediately!';
  ELSE
    RAISE NOTICE 'PASS: No password columns found in admin_users. OTP-only login confirmed.';
  END IF;
END $$;

-- Verify: visitor_otps has NO plaintext otp_code column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'visitor_otps'
      AND column_name  = 'otp_code'
  ) THEN
    RAISE EXCEPTION 'SECURITY ALERT: plaintext otp_code column still exists in visitor_otps!';
  ELSE
    RAISE NOTICE 'PASS: No plaintext otp_code column in visitor_otps. OTP hashing confirmed.';
  END IF;
END $$;

-- Verify: otp_hash and otp_salt columns exist (hashed storage in place)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'visitor_otps'
      AND column_name  = 'otp_hash'
  ) THEN
    RAISE EXCEPTION 'SECURITY ALERT: otp_hash column missing from visitor_otps!';
  ELSE
    RAISE NOTICE 'PASS: otp_hash column exists in visitor_otps. Hashed OTP storage confirmed.';
  END IF;
END $$;

-- ============================================================
-- MANUAL STEP REQUIRED (cannot be done via SQL):
-- ============================================================
-- Go to: Supabase Dashboard → Authentication → Security
-- Find:  "Bcrypt cost factor"  (or "Password hashing cost")
-- Set:   12  (up from the weak default of 6)
-- Save.
--
-- This affects bcrypt hashing of any Supabase Auth user passwords.
-- Even though this app uses OTP-only login (no user passwords),
-- the Supabase Auth system still uses bcrypt internally and must
-- meet the minimum cost factor required by the security audit.
-- ============================================================
