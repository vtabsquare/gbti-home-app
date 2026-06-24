import { supabase } from '@/integrations/supabase/client';
import type { AddOn, ConfigState, HomeType, KitchenType, Material, RoofType } from '@/store/configurator';
import { getElevationLookupKeys, getElevationVariantSignature, getElevationVisualAddons } from '@/store/configurator';

export type ElevationVariantState = Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons' | 'roof' | 'material'>;

export interface ElevationVariantRecord {
  id: string;
  variant_signature: string;
  legacy_preset_key: string | null;
  home_type: HomeType | null;
  bedrooms: number | null;
  bathrooms: number | null;
  kitchen: KitchenType | null;
  is_double_storey: boolean | null;
  roof: RoofType | null;
  material: Material | null;
  visual_addons: string[];
  preset_id: number | null;
}

export interface ElevationImageRecord {
  id: string;
  image_url: string;
  image_path: string;
  variant_id?: string | null;
  preset_key?: string;
}

const buildVariantInsert = (state: ElevationVariantState, presetId: number, legacyPresetKey: string) => ({
  variant_signature: getElevationVariantSignature(state, presetId),
  legacy_preset_key: legacyPresetKey,
  home_type: state.homeType,
  bedrooms: state.bedrooms,
  bathrooms: state.bathrooms,
  kitchen: state.kitchen,
  is_double_storey: state.isDoubleStorey,
  roof: state.roof,
  material: state.material,
  visual_addons: getElevationVisualAddons(state.addons || []),
  preset_id: presetId,
});

export const resolveElevationVariant = async (state: ElevationVariantState, presetId: number): Promise<ElevationVariantRecord> => {
  const lookupKeys = getElevationLookupKeys(state, presetId);
  const legacyPresetKey = lookupKeys[0];
  const variantSignature = getElevationVariantSignature(state, presetId);
  const visualAddons = getElevationVisualAddons(state.addons || []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('resolve_elevation_variant', {
    p_variant_signature: variantSignature,
    p_legacy_preset_key: legacyPresetKey,
    p_lookup_keys:       lookupKeys,
    p_home_type:         state.homeType,
    p_bedrooms:          state.bedrooms,
    p_bathrooms:         state.bathrooms,
    p_kitchen:           state.kitchen,
    p_is_double_storey:  state.isDoubleStorey,
    p_roof:              state.roof,
    p_material:          state.material,
    p_visual_addons:     visualAddons,
    p_preset_id:         presetId,
  });

  if (error) throw error;
  return data as ElevationVariantRecord;
};

export const fetchElevationImagesByVariant = async (
  variantId: string,
  lookupKeys: string[] = []
): Promise<ElevationImageRecord[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('fetch_elevation_images_by_variant', {
    p_variant_id:  variantId,
    p_lookup_keys: lookupKeys,
  });

  if (error) throw error;
  return (data || []) as ElevationImageRecord[];
};

export const fetchElevationVariantFamily = async (state: Pick<ElevationVariantState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey'>, presetId: number) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('fetch_elevation_variant_family', {
    p_home_type:        state.homeType,
    p_bedrooms:         state.bedrooms,
    p_bathrooms:        state.bathrooms,
    p_kitchen:          state.kitchen,
    p_is_double_storey: state.isDoubleStorey,
    p_preset_id:        presetId,
  });

  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((row: any) => ({
    ...row,
    image_count: row.elevation_images?.length || 0,
    sample_url: row.elevation_images?.[0]?.image_url || '',
  }));
};

export const normalizeParsedVariantAddons = (addons: string[]) => addons.filter((addon): addon is AddOn => (
  ['carport', 'landscaping', 'fence', 'solar', 'water_tank'].includes(addon)
));
