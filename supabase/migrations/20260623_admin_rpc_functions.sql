-- ============================================================
-- Admin SECURITY DEFINER functions
-- These allow the Admin Panel to query data directly using the
-- anon key, since SECURITY DEFINER functions bypass RLS.
-- Session token is verified inside each function.
-- ============================================================

-- Helper: verify session token (already exists, but recreate to be safe)
CREATE OR REPLACE FUNCTION verify_admin_session(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM admin_users
    WHERE session_token = p_token
      AND session_expires_at > NOW()
  );
END;
$$;

-- Get all leads (admin only)
CREATE OR REPLACE FUNCTION admin_get_leads(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (
    SELECT json_agg(row_to_json(l) ORDER BY l.created_at DESC)
    FROM leads l
  );
END;
$$;

-- Delete a lead (admin only)
CREATE OR REPLACE FUNCTION admin_delete_lead(p_token TEXT, p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM leads WHERE id = p_lead_id;
  RETURN TRUE;
END;
$$;

-- Get all admin settings (admin only)
CREATE OR REPLACE FUNCTION admin_get_settings(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (SELECT json_agg(row_to_json(s)) FROM admin_settings s);
END;
$$;

-- Upsert admin settings (admin only)
CREATE OR REPLACE FUNCTION admin_upsert_settings(p_token TEXT, p_key TEXT, p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO admin_settings (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
  RETURN TRUE;
END;
$$;

-- Get mortgage settings (admin only)
CREATE OR REPLACE FUNCTION admin_get_mortgage_settings(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (SELECT row_to_json(m) FROM mortgage_settings m LIMIT 1);
END;
$$;

-- Upsert mortgage settings (admin only)
CREATE OR REPLACE FUNCTION admin_upsert_mortgage_settings(
  p_token TEXT,
  p_id UUID,
  p_default_interest_rate NUMERIC,
  p_min_interest_rate NUMERIC,
  p_max_interest_rate NUMERIC,
  p_default_tenure INT,
  p_min_tenure INT,
  p_max_tenure INT,
  p_min_down_payment_percent NUMERIC,
  p_max_ltv NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE mortgage_settings
    SET default_interest_rate = p_default_interest_rate,
        min_interest_rate = p_min_interest_rate,
        max_interest_rate = p_max_interest_rate,
        default_tenure = p_default_tenure,
        min_tenure = p_min_tenure,
        max_tenure = p_max_tenure,
        min_down_payment_percent = p_min_down_payment_percent,
        max_ltv = p_max_ltv,
        updated_at = NOW()
    WHERE id = p_id;
  ELSE
    INSERT INTO mortgage_settings (
      default_interest_rate, min_interest_rate, max_interest_rate,
      default_tenure, min_tenure, max_tenure,
      min_down_payment_percent, max_ltv
    ) VALUES (
      p_default_interest_rate, p_min_interest_rate, p_max_interest_rate,
      p_default_tenure, p_min_tenure, p_max_tenure,
      p_min_down_payment_percent, p_max_ltv
    );
  END IF;
  RETURN TRUE;
END;
$$;

-- Get fee rules (admin only)
CREATE OR REPLACE FUNCTION admin_get_fee_rules(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (SELECT row_to_json(f) FROM fee_rules f LIMIT 1);
END;
$$;

-- ============================================================
-- DONE - run this in Supabase SQL Editor
-- ============================================================
