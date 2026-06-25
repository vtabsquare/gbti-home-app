-- ============================================================
-- HOTFIX: Fix api.verify_admin_login_otp parameter order
-- public.verify_admin_login_otp expects (p_email, p_otp)
-- ============================================================

CREATE OR REPLACE FUNCTION api.verify_admin_login_otp(p_email TEXT, p_otp TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_admin_login_otp(p_email, p_otp);
END;
$$;

GRANT EXECUTE ON FUNCTION api.verify_admin_login_otp(TEXT, TEXT) TO anon, authenticated;
