-- ============================================================
-- Admin Panel API functions in api schema
-- All admin operations go through session-verified SECURITY
-- DEFINER functions so the anon key can be used safely.
-- ============================================================

-- ── Leads ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api.admin_get_leads(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN COALESCE(
    (SELECT json_agg(row_to_json(l) ORDER BY l.created_at DESC) FROM public.leads l),
    '[]'::json
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.admin_delete_lead(p_token TEXT, p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.leads WHERE id = p_lead_id;
  RETURN TRUE;
END;
$$;

-- ── Admin Settings ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api.admin_get_settings(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN COALESCE(
    (SELECT json_agg(row_to_json(s)) FROM public.admin_settings s),
    '[]'::json
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.admin_upsert_settings(p_token TEXT, p_key TEXT, p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO public.admin_settings (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
  RETURN TRUE;
END;
$$;

-- ── Mortgage Settings ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION api.admin_get_mortgage_settings(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (SELECT row_to_json(m) FROM public.mortgage_settings m LIMIT 1);
END;
$$;

CREATE OR REPLACE FUNCTION api.admin_upsert_mortgage_settings(
  p_token                    TEXT,
  p_id                       UUID,
  p_default_interest_rate    NUMERIC,
  p_min_interest_rate        NUMERIC,
  p_max_interest_rate        NUMERIC,
  p_default_tenure           INT,
  p_min_tenure               INT,
  p_max_tenure               INT,
  p_min_down_payment_percent NUMERIC,
  p_max_ltv                  NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.mortgage_settings SET
      default_interest_rate    = p_default_interest_rate,
      min_interest_rate        = p_min_interest_rate,
      max_interest_rate        = p_max_interest_rate,
      default_tenure           = p_default_tenure,
      min_tenure               = p_min_tenure,
      max_tenure               = p_max_tenure,
      min_down_payment_percent = p_min_down_payment_percent,
      max_ltv                  = p_max_ltv,
      updated_at               = NOW()
    WHERE id = p_id;
  ELSE
    INSERT INTO public.mortgage_settings (
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

-- ── Fee Rules ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api.admin_get_fee_rules(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (SELECT row_to_json(f) FROM public.fee_rules f LIMIT 1);
END;
$$;

CREATE OR REPLACE FUNCTION api.admin_update_fee_rules(
  p_token          TEXT,
  p_solicitor      NUMERIC,
  p_solicitor_fixed NUMERIC,
  p_registry       NUMERIC,
  p_stamp          NUMERIC,
  p_misc           NUMERIC,
  p_vat_enabled    BOOLEAN,
  p_vat_percent    NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.fee_rules SET
    solicitor_fee_percent = p_solicitor,
    solicitor_fixed_charge = p_solicitor_fixed,
    registry_fee_percent  = p_registry,
    stamp_duty_percent    = p_stamp,
    misc_fee              = p_misc,
    vat_enabled           = p_vat_enabled,
    vat_percent           = p_vat_percent;
  RETURN TRUE;
END;
$$;

-- ── Permissions ───────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION api.admin_get_leads                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_delete_lead                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_get_settings               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_upsert_settings            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_get_mortgage_settings      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_upsert_mortgage_settings   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_get_fee_rules              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_update_fee_rules           TO anon, authenticated;
