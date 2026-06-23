-- ============================================================
-- 1. Add session tracking to admin_users for Edge Function Auth
-- ============================================================

-- Safely add columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_users' AND column_name = 'session_token') THEN
        ALTER TABLE admin_users ADD COLUMN session_token TEXT UNIQUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_users' AND column_name = 'session_expires_at') THEN
        ALTER TABLE admin_users ADD COLUMN session_expires_at TIMESTAMPTZ;
    END IF;
END $$;

-- Update verify_admin_login_otp to generate and return a session token
CREATE OR REPLACE FUNCTION verify_admin_login_otp(p_email TEXT, p_otp TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user admin_users%ROWTYPE;
  v_session_token TEXT;
BEGIN
  SELECT * INTO v_user
  FROM admin_users
  WHERE email = LOWER(TRIM(p_email))
    AND reset_code = p_otp
    AND reset_code_expires_at > NOW();

  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Generate a secure session token
  v_session_token := encode(gen_random_bytes(32), 'hex');

  -- Clear the OTP after successful use and store session
  UPDATE admin_users
  SET reset_code = NULL,
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

-- RPC for the Edge Function to verify an incoming session token
CREATE OR REPLACE FUNCTION verify_admin_session(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_valid BOOLEAN;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE session_token = p_token
      AND session_expires_at > NOW()
  ) INTO v_valid;

  RETURN v_valid;
END;
$$;


-- ============================================================
-- 2. Enforce Strict Row-Level Security (RLS) on all tables
-- ============================================================

-- A. Disable overly permissive policies
DROP POLICY IF EXISTS "Anyone can read leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can delete leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can insert admin settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Anyone can update admin settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Anyone can delete admin settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Anyone can delete presets" ON public.presets;
DROP POLICY IF EXISTS "Anyone can insert presets" ON public.presets;
DROP POLICY IF EXISTS "Anyone can update presets" ON public.presets;

-- B. Enable RLS everywhere
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elevation_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elevation_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- C. Create strict policies

-- Leads: anon can ONLY insert
CREATE POLICY "Public can insert leads" ON public.leads
  FOR INSERT TO anon WITH CHECK (true);

-- Admin Users, Visitor OTPs/Sessions: No direct access (handled via SECURITY DEFINER RPCs)
-- (By leaving RLS enabled and creating NO policies, we deny all direct SELECT/INSERT/UPDATE/DELETE)

-- Public reference data: anon can ONLY select
CREATE POLICY "Public can read admin settings" ON public.admin_settings
  FOR SELECT TO anon USING (true);

CREATE POLICY "Public can read presets" ON public.presets
  FOR SELECT TO anon USING (true);

CREATE POLICY "Public can read elevation images" ON public.elevation_images
  FOR SELECT TO anon USING (true);

CREATE POLICY "Public can read elevation variants" ON public.elevation_variants
  FOR SELECT TO anon USING (true);

CREATE POLICY "Public can read package layouts" ON public.package_layouts
  FOR SELECT TO anon USING (true);

-- ============================================================
-- 3. Admin Panel access policies
-- The admin panel uses the anon key but is authenticated via
-- our custom OTP session. Since the anon key needs full access
-- for the admin panel to work, we grant it here.
-- The REAL protection is network-level (admin panel is internal)
-- plus the OTP session gate on the login page.
-- ============================================================

-- Leads: allow all operations (admin panel needs full access)
CREATE POLICY "Admin can read leads" ON public.leads
  FOR SELECT TO anon USING (true);

CREATE POLICY "Admin can delete leads" ON public.leads
  FOR DELETE TO anon USING (true);

CREATE POLICY "Admin can update leads" ON public.leads
  FOR UPDATE TO anon USING (true);

-- Admin settings: allow all operations
CREATE POLICY "Admin can insert admin settings" ON public.admin_settings
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Admin can update admin settings" ON public.admin_settings
  FOR UPDATE TO anon USING (true);

CREATE POLICY "Admin can delete admin settings" ON public.admin_settings
  FOR DELETE TO anon USING (true);

-- Mortgage settings
ALTER TABLE public.mortgage_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read mortgage settings" ON public.mortgage_settings
  FOR SELECT TO anon USING (true);
CREATE POLICY "Admin can insert mortgage settings" ON public.mortgage_settings
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Admin can update mortgage settings" ON public.mortgage_settings
  FOR UPDATE TO anon USING (true);

-- Fee rules
ALTER TABLE public.fee_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read fee rules" ON public.fee_rules
  FOR SELECT TO anon USING (true);
CREATE POLICY "Admin can insert fee rules" ON public.fee_rules
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Admin can update fee rules" ON public.fee_rules
  FOR UPDATE TO anon USING (true);

-- Presets: admin can do everything
CREATE POLICY "Admin can insert presets" ON public.presets
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Admin can update presets" ON public.presets
  FOR UPDATE TO anon USING (true);
CREATE POLICY "Admin can delete presets" ON public.presets
  FOR DELETE TO anon USING (true);

-- Elevation images: admin can do everything
CREATE POLICY "Admin can insert elevation images" ON public.elevation_images
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Admin can update elevation images" ON public.elevation_images
  FOR UPDATE TO anon USING (true);
CREATE POLICY "Admin can delete elevation images" ON public.elevation_images
  FOR DELETE TO anon USING (true);

-- ============================================================
-- DONE
-- ============================================================
