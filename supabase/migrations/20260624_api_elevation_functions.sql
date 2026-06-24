-- ============================================================
-- GBTI-WEB-06 follow-up: api schema wrappers for elevation tables
-- Needed because elevation_variants + elevation_images were still
-- accessed via direct supabase.from() calls in elevationVariants.ts
-- ============================================================

-- ─── resolve_elevation_variant ────────────────────────────────────────────────
-- Encapsulates the full resolution logic from elevationVariants.ts:
--   1. Lookup by variant_signature  →  maybe update legacy_preset_key
--   2. Lookup by each legacy key    →  maybe update signature
--   3. Insert new variant
CREATE OR REPLACE FUNCTION api.resolve_elevation_variant(
  p_variant_signature  TEXT,
  p_legacy_preset_key  TEXT,
  p_lookup_keys        TEXT[],
  p_home_type          TEXT,
  p_bedrooms           INT,
  p_bathrooms          INT,
  p_kitchen            TEXT,
  p_is_double_storey   BOOLEAN,
  p_roof               TEXT,
  p_material           TEXT,
  p_visual_addons      TEXT[],
  p_preset_id          INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_variant  public.elevation_variants%ROWTYPE;
  v_updated  public.elevation_variants%ROWTYPE;
  v_inserted public.elevation_variants%ROWTYPE;
  v_key      TEXT;
BEGIN
  -- Step 1: try by variant_signature
  SELECT * INTO v_variant
  FROM public.elevation_variants
  WHERE variant_signature = p_variant_signature
  LIMIT 1;

  IF v_variant.id IS NOT NULL THEN
    IF v_variant.legacy_preset_key IS NULL OR v_variant.legacy_preset_key != p_legacy_preset_key THEN
      UPDATE public.elevation_variants
      SET legacy_preset_key = p_legacy_preset_key, updated_at = NOW()
      WHERE id = v_variant.id
      RETURNING * INTO v_updated;
      RETURN row_to_json(v_updated);
    END IF;
    RETURN row_to_json(v_variant);
  END IF;

  -- Step 2: try each lookup key
  IF p_lookup_keys IS NOT NULL THEN
    FOREACH v_key IN ARRAY p_lookup_keys LOOP
      SELECT * INTO v_variant
      FROM public.elevation_variants
      WHERE legacy_preset_key = v_key
      LIMIT 1;

      IF v_variant.id IS NOT NULL THEN
        IF v_variant.variant_signature != p_variant_signature THEN
          UPDATE public.elevation_variants
          SET variant_signature = p_variant_signature,
              legacy_preset_key = v_key,
              home_type         = p_home_type,
              bedrooms          = p_bedrooms,
              bathrooms         = p_bathrooms,
              kitchen           = p_kitchen,
              is_double_storey  = p_is_double_storey,
              roof              = p_roof,
              material          = p_material,
              visual_addons     = p_visual_addons,
              preset_id         = p_preset_id,
              updated_at        = NOW()
          WHERE id = v_variant.id
          RETURNING * INTO v_updated;
          RETURN row_to_json(v_updated);
        END IF;
        RETURN row_to_json(v_variant);
      END IF;
    END LOOP;
  END IF;

  -- Step 3: insert new variant
  INSERT INTO public.elevation_variants (
    variant_signature, legacy_preset_key, home_type, bedrooms, bathrooms,
    kitchen, is_double_storey, roof, material, visual_addons, preset_id
  ) VALUES (
    p_variant_signature, p_legacy_preset_key, p_home_type, p_bedrooms, p_bathrooms,
    p_kitchen, p_is_double_storey, p_roof, p_material, p_visual_addons, p_preset_id
  )
  RETURNING * INTO v_inserted;

  RETURN row_to_json(v_inserted);
END;
$$;

-- ─── fetch_elevation_images_by_variant ────────────────────────────────────────
-- Returns images by variant_id first, then falls back to preset_key lookup.
-- Returns only the fields used by the frontend.
CREATE OR REPLACE FUNCTION api.fetch_elevation_images_by_variant(
  p_variant_id  TEXT,
  p_lookup_keys TEXT[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_images JSON;
  v_key    TEXT;
BEGIN
  -- Try by variant_id
  SELECT json_agg(
    json_build_object(
      'id',         e.id,
      'image_url',  e.image_url,
      'image_path', e.image_path,
      'variant_id', e.variant_id,
      'preset_key', e.preset_key
    ) ORDER BY e.created_at ASC
  )
  INTO v_images
  FROM public.elevation_images e
  WHERE e.variant_id = p_variant_id::uuid;

  IF v_images IS NOT NULL THEN
    RETURN v_images;
  END IF;

  -- Fall back to preset_key lookup
  IF p_lookup_keys IS NOT NULL THEN
    FOREACH v_key IN ARRAY p_lookup_keys LOOP
      SELECT json_agg(
        json_build_object(
          'id',         e.id,
          'image_url',  e.image_url,
          'image_path', e.image_path,
          'variant_id', e.variant_id,
          'preset_key', e.preset_key
        ) ORDER BY e.created_at ASC
      )
      INTO v_images
      FROM public.elevation_images e
      WHERE e.preset_key = v_key;

      IF v_images IS NOT NULL THEN
        RETURN v_images;
      END IF;
    END LOOP;
  END IF;

  RETURN '[]'::JSON;
END;
$$;

-- ─── fetch_elevation_variant_family ───────────────────────────────────────────
-- Used by AdminDashboard / 3D preview to list all variants for a config.
CREATE OR REPLACE FUNCTION api.fetch_elevation_variant_family(
  p_home_type        TEXT,
  p_bedrooms         INT,
  p_bathrooms        INT,
  p_kitchen          TEXT,
  p_is_double_storey BOOLEAN,
  p_preset_id        INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN COALESCE(
    (
      SELECT json_agg(r ORDER BY r.updated_at DESC)
      FROM (
        SELECT
          ev.id, ev.variant_signature, ev.legacy_preset_key,
          ev.home_type, ev.bedrooms, ev.bathrooms, ev.kitchen,
          ev.is_double_storey, ev.roof, ev.material,
          ev.visual_addons, ev.preset_id, ev.updated_at,
          (
            SELECT COALESCE(json_agg(json_build_object('id', ei.id, 'image_url', ei.image_url)), '[]'::json)
            FROM public.elevation_images ei
            WHERE ei.variant_id = ev.id
          ) AS elevation_images
        FROM public.elevation_variants ev
        WHERE ev.home_type         = p_home_type
          AND ev.bedrooms          = p_bedrooms
          AND ev.bathrooms         = p_bathrooms
          AND ev.kitchen           = p_kitchen
          AND ev.is_double_storey  = p_is_double_storey
          AND ev.preset_id         = p_preset_id
      ) r
    ),
    '[]'::JSON
  );
END;
$$;

-- ─── Permissions ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION api.resolve_elevation_variant      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.fetch_elevation_images_by_variant TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api.fetch_elevation_variant_family TO anon, authenticated;
