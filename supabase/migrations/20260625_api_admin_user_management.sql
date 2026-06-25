-- ============================================================
-- Add missing api schema wrappers for admin user management
-- and password reset functions
-- ============================================================

-- Admin login OTP wrappers already exist. Adding missing ones:

CREATE OR REPLACE FUNCTION api.set_admin_reset_code(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.set_admin_reset_code(p_email);
END;
$$;

CREATE OR REPLACE FUNCTION api.verify_admin_reset_code(p_email TEXT, p_code TEXT, p_new_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_admin_reset_code(p_email, p_code, p_new_password);
END;
$$;

CREATE OR REPLACE FUNCTION api.list_admin_users()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.list_admin_users();
END;
$$;

CREATE OR REPLACE FUNCTION api.create_admin_user(p_email TEXT, p_display_name TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.create_admin_user(p_email, p_display_name);
END;
$$;

CREATE OR REPLACE FUNCTION api.delete_admin_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.delete_admin_user(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.change_admin_password(p_user_id UUID, p_new_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.change_admin_password(p_user_id, p_new_password);
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION api.set_admin_reset_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.verify_admin_reset_code(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_admin_users() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.create_admin_user(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_admin_user(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.change_admin_password(UUID, TEXT) TO anon, authenticated;
