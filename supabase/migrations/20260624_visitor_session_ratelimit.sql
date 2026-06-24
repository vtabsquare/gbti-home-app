-- ============================================================
-- GBTI-WEB-07 Fix: Unrestricted User Account Registration Lacks captcha/Ratelimit
-- 
-- 1. Rate limits store_visitor_session by IP address
-- ============================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT oid::regprocedure::text AS sig
        FROM pg_proc
        WHERE proname = 'store_visitor_session'
          AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION store_visitor_session(
  p_email            TEXT,
  p_device_type      TEXT,
  p_browser          TEXT,
  p_os               TEXT,
  p_screen_width     INTEGER,
  p_screen_height    INTEGER,
  p_user_agent       TEXT,
  p_full_name        TEXT    DEFAULT NULL,
  p_phone            TEXT    DEFAULT NULL,
  p_project_timeline TEXT    DEFAULT NULL,
  p_preferred_branch TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id           UUID;
  v_ua_truncated TEXT;
  v_ip           TEXT;
BEGIN
  -- Get IP address from headers
  v_ip := COALESCE(
    current_setting('request.headers', true)::json->>'x-forwarded-for',
    current_setting('request.headers', true)::json->>'cf-connecting-ip',
    'unknown-ip'
  );

  -- Rate limit by IP (max 10 requests per 15 minutes)
  IF is_rate_limited(v_ip, 'store_visitor_session', 10, 15) THEN
    -- In a real app we might RAISE EXCEPTION, but returning NULL or a specific UUID is safer for the frontend if it doesn't handle errors well.
    -- However, the frontend might break if it expects a UUID. Let's raise an exception.
    RAISE EXCEPTION 'Rate limit exceeded';
  END IF;

  PERFORM record_auth_attempt(v_ip, 'store_visitor_session');

  -- Truncate user_agent to 80 chars maximum (data minimisation - GBTI-WEB-04)
  v_ua_truncated := CASE
    WHEN p_user_agent IS NULL         THEN NULL
    WHEN LENGTH(p_user_agent) <= 80   THEN p_user_agent
    ELSE SUBSTRING(p_user_agent, 1, 80) || ' [truncated]'
  END;

  INSERT INTO visitor_sessions (
    email, device_type, browser, os,
    screen_width,
    screen_height,
    user_agent,
    full_name, phone, project_timeline, preferred_branch
  )
  VALUES (
    LOWER(TRIM(p_email)),
    p_device_type,
    p_browser,
    p_os,
    p_screen_width,
    NULL,              -- screen_height omitted (unnecessary PII per GBTI-WEB-04)
    v_ua_truncated,    -- truncated, not full string
    p_full_name,
    p_phone,
    p_project_timeline,
    p_preferred_branch
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION store_visitor_session TO anon;
