-- ============================================================
-- GBTI-WEB-06 follow-up: remaining api schema wrappers
-- Admin write operations + elevation image reads
-- ============================================================

-- ─── Public reads ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api.get_elevation_images()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT json_agg(e ORDER BY e.created_at DESC) FROM public.elevation_images e),
       '[]'::json
  );
END;
$$;

-- ─── Admin writes (session-verified) ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION api.admin_update_pricing(
  p_token TEXT,
  p_value JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO public.admin_settings (key, value, updated_at)
  VALUES ('pricing', p_value, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION api.admin_delete_elevation_image(
  p_token TEXT,
  p_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.elevation_images WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION api.admin_insert_elevation_image(
  p_token      TEXT,
  p_preset_key TEXT,
  p_image_path TEXT,
  p_image_url  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.verify_admin_session(p_token) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO public.elevation_images (preset_key, image_path, image_url)
  VALUES (p_preset_key, p_image_path, p_image_url)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── Permissions ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION api.get_elevation_images                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_update_pricing                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_delete_elevation_image           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_insert_elevation_image           TO anon, authenticated;
