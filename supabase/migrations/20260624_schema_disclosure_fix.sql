-- ============================================================
-- GBTI-WEB-06 Fix: Database Schema Disclosure via PostgREST
-- CWE-209 | OWASP A05:2021 | CVSS 5.3 MEDIUM
--
-- The Problem:
--   GET /rest/v1/users  →  hint: "Perhaps you meant public.admin_users"
--   Anon can enumerate ALL table names using PGRST205 hints even
--   without any access rights, allowing full schema mapping.
--
-- The Fix (three-part):
--   Part 1 (this file) — CREATE api schema with SECURITY DEFINER
--     wrappers for every operation the anon role needs. Tables stay
--     in public; only functions are exposed via api.
--   Part 2 (frontend) — Replace supabase.from('table') with
--     supabase.rpc('function') throughout the main app.
--   Part 3 (manual) — Supabase Dashboard → Settings → API →
--     change Exposed Schemas from "public" to "api".
--     After that, /rest/v1/non_existent returns PGRST205 with hints
--     from api schema only — which has NO tables, only functions.
--     PostgREST cannot suggest table names it cannot see.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS api;

GRANT USAGE ON SCHEMA api TO anon, authenticated;

-- ============================================================
-- LEAD OPERATIONS (replaces direct anon INSERT/UPDATE on leads)
-- ============================================================

CREATE OR REPLACE FUNCTION api.submit_lead(
  p_id         UUID,
  p_name       TEXT,
  p_phone      TEXT,
  p_email      TEXT,
  p_timeline   TEXT    DEFAULT NULL,
  p_config     JSONB   DEFAULT NULL,
  p_total_cost NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.leads (id, name, phone, email, timeline, config, total_cost)
  VALUES (p_id, p_name, p_phone, p_email, p_timeline, p_config, p_total_cost);
  RETURN p_id;
END;
$$;

-- Tracks email-change at send-to-inbox step (was a direct leads UPDATE)
CREATE OR REPLACE FUNCTION api.update_lead_config(
  p_id     UUID,
  p_config JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.leads SET config = p_config WHERE id = p_id;
END;
$$;

-- ============================================================
-- PRESET OPERATIONS (replaces direct anon CRUD on presets)
-- ============================================================

CREATE OR REPLACE FUNCTION api.get_presets()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(p ORDER BY p.created_at ASC), '[]'::json)
    FROM public.presets p
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.save_preset(
  p_name      TEXT,
  p_plan_data JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row public.presets;
BEGIN
  INSERT INTO public.presets (name, plan_data)
  VALUES (p_name, p_plan_data)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION api.update_preset(
  p_id        UUID,
  p_plan_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.presets SET plan_data = p_plan_data WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION api.delete_preset(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.presets WHERE id = p_id;
END;
$$;

-- ============================================================
-- PACKAGE LAYOUTS (replaces direct anon SELECT/UPSERT)
-- ============================================================

CREATE OR REPLACE FUNCTION api.get_package_layouts()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(p), '[]'::json)
    FROM public.package_layouts p
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.upsert_package_layout(
  p_package_key TEXT,
  p_plan_data   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.package_layouts (package_key, plan_data, updated_at)
  VALUES (p_package_key, p_plan_data, NOW())
  ON CONFLICT (package_key) DO UPDATE
    SET plan_data  = EXCLUDED.plan_data,
        updated_at = NOW();
END;
$$;

-- ============================================================
-- SETTINGS (pricing + mortgage — replaces direct anon SELECT)
-- ============================================================

-- Returns the full admin_settings row for key='pricing'
-- Shape: { key, value, updated_at } — matches pricingRes.data?.value usage
CREATE OR REPLACE FUNCTION api.get_pricing()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT row_to_json(a)
    FROM public.admin_settings a
    WHERE a.key = 'pricing'
    LIMIT 1
  );
END;
$$;

-- Returns single mortgage_settings row — matches mortgageRes.data.* usage
CREATE OR REPLACE FUNCTION api.get_mortgage_settings()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (SELECT row_to_json(m) FROM public.mortgage_settings m LIMIT 1);
END;
$$;

-- ============================================================
-- VISITOR OTP + SESSION (pass-through wrappers)
-- ============================================================

CREATE OR REPLACE FUNCTION api.store_visitor_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.store_visitor_otp(p_email);
END;
$$;

CREATE OR REPLACE FUNCTION api.verify_visitor_otp(p_email TEXT, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_visitor_otp(p_email, p_otp);
END;
$$;

CREATE OR REPLACE FUNCTION api.store_visitor_session(
  p_email            TEXT,
  p_device_type      TEXT,
  p_browser          TEXT,
  p_os               TEXT,
  p_screen_width     INTEGER,
  p_screen_height    INTEGER,
  p_user_agent       TEXT,
  p_full_name        TEXT DEFAULT NULL,
  p_phone            TEXT DEFAULT NULL,
  p_project_timeline TEXT DEFAULT NULL,
  p_preferred_branch TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.store_visitor_session(
    p_email, p_device_type, p_browser, p_os,
    p_screen_width, p_screen_height, p_user_agent,
    p_full_name, p_phone, p_project_timeline, p_preferred_branch
  );
END;
$$;

-- ============================================================
-- ADMIN AUTH (pass-through wrappers so AdminDashboard works
-- after Supabase Dashboard switches exposed schema to "api")
-- ============================================================

CREATE OR REPLACE FUNCTION api.send_admin_login_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.send_admin_login_otp(p_email);
END;
$$;

CREATE OR REPLACE FUNCTION api.verify_admin_login_otp(p_otp TEXT, p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_admin_login_otp(p_otp, p_email);
END;
$$;

CREATE OR REPLACE FUNCTION api.verify_admin_session(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.verify_admin_session(p_token);
END;
$$;

-- ============================================================
-- GRANT EXECUTE on all api.* functions to anon + authenticated
-- ============================================================

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO anon, authenticated;

-- ============================================================
-- NOTE: Direct anon policies on leads/presets/package_layouts
-- etc. are intentionally NOT dropped here. They remain as a
-- fallback until the Supabase Dashboard exposed-schema change
-- is applied (Step 3 in remediation checklist). Once that is
-- done, run this to clean up:
--
--   DROP POLICY IF EXISTS "Public can insert leads"        ON public.leads;
--   DROP POLICY IF EXISTS "Anyone can read package layouts" ON public.package_layouts;
--   DROP POLICY IF EXISTS "Anyone can upsert package layouts" ON public.package_layouts;
--   DROP POLICY IF EXISTS "Anyone can update package layouts" ON public.package_layouts;
--   DROP POLICY IF EXISTS "Public can read presets"        ON public.presets;
--   DROP POLICY IF EXISTS "Anyone can read mortgage settings" ON public.mortgage_settings;
--   DROP POLICY IF EXISTS "Anyone can read fee rules"      ON public.fee_rules;
--
-- ============================================================
