-- ============================================================
-- GBTI-WEB-02 Critical Fix: Admin Credential Exposure
-- Drop password_hash entirely (never used — login is OTP-only)
-- Add explicit DENY policies on admin_users
-- ============================================================

-- STEP 1: Remove the password_hash column permanently
-- This eliminates the credential exposure attack surface entirely.
ALTER TABLE public.admin_users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.admin_users DROP COLUMN IF EXISTS must_change_password;

-- STEP 2: Add explicit DENY-ALL policies on admin_users
-- RLS is already enabled. These ensure no anon operation is possible.
-- (Even though no SELECT policy = empty result, we also block PATCH/UPDATE explicitly)

-- Block any UPDATE on admin_users from anon (closes the account takeover vector)
CREATE POLICY "Deny anon update admin_users" ON public.admin_users
  AS RESTRICTIVE
  FOR UPDATE TO anon
  USING (false);

-- Block any DELETE on admin_users from anon
CREATE POLICY "Deny anon delete admin_users" ON public.admin_users
  AS RESTRICTIVE
  FOR DELETE TO anon
  USING (false);

-- Block any INSERT on admin_users from anon
CREATE POLICY "Deny anon insert admin_users" ON public.admin_users
  AS RESTRICTIVE
  FOR INSERT TO anon
  WITH CHECK (false);

-- STEP 3: Update create_admin_user to NOT accept or store a password
-- OTP-only login means no password is ever needed.
CREATE OR REPLACE FUNCTION create_admin_user(
  p_email TEXT,
  p_display_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user admin_users%ROWTYPE;
BEGIN
  -- Prevent duplicate emails
  IF EXISTS (SELECT 1 FROM admin_users WHERE email = LOWER(TRIM(p_email))) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  INSERT INTO admin_users (email, display_name, created_at, updated_at)
  VALUES (
    LOWER(TRIM(p_email)),
    TRIM(p_display_name),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_user;

  RETURN json_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'display_name', v_user.display_name
  );
END;
$$;

-- STEP 4: Also update delete_admin_user to be safe
CREATE OR REPLACE FUNCTION delete_admin_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM admin_users WHERE id = p_user_id;
  RETURN TRUE;
END;
$$;

-- ============================================================
-- DONE - Run this in Supabase SQL Editor
-- ============================================================
