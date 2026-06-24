import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/integrations/supabase/client';

export type LandChoice = 'own' | 'need' | null;
export type LandSize = 'small' | 'medium' | 'large' | 'custom' | null;
export type HomeType = 'starter' | 'family' | 'premium' | 'turnkey' | 'young_professional' | 'private_purchase';
export type FinishingQuality = 'standard' | 'premium';
export type KitchenType = 'standard' | 'open' | 'galley';
export type LayoutStyle = 'default' | 'open_plan' | 'entertainer' | 'family_suite';
export type AddOn = 'solar' | 'carport' | 'water_tank' | 'smart_home' | 'fence' | 'landscaping';
export type RoofType = 'gable' | 'flat';
export type Material = 'budget' | 'modern' | 'luxury';
export const FAMILY_DOUBLE_STOREY_PACKAGE_KEY = 'family-double-storey';
const BUILT_IN_PRESET_PREFIX = '__builtin_floor_plan__';
const ELEVATION_PRESET_PREFIX = '__elevation_variant__';
export const ELEVATION_VARIANT_VERSION = 'v1';
const ELEVATION_VISUAL_ADDONS: AddOn[] = ['carport', 'landscaping', 'fence', 'solar', 'water_tank'];
// Only carport physically reshapes the floor plan. Landscaping ("Furniture") is visual-only
// and must NOT be treated as a layout-affecting addon — doing so changes the floor plan
// when the customer selects Furniture, which should not happen.
const FAMILY_DOUBLE_STOREY_LAYOUT_ADDONS: AddOn[] = ['carport'];

export const getElevationVisualAddons = (addons: AddOn[] = []) =>
  [...addons].filter((addon) => ELEVATION_VISUAL_ADDONS.includes(addon)).sort();

export const getFamilyDoubleStoreyLayoutAddons = (addons: AddOn[] = []) =>
  [...addons].filter((addon) => FAMILY_DOUBLE_STOREY_LAYOUT_ADDONS.includes(addon)).sort();

export const getBuiltInPresetKey = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons'>, presetId: number) => {
  // Only carport is layout-affecting and should trigger different preset overrides.
  // Landscaping ("Furniture"), solar, water_tank, fence, smart_home are visual-only.
  const layoutAffectingAddons = (state.addons || []).filter(a => a === 'carport');
  return `${BUILT_IN_PRESET_PREFIX}${state.homeType}_${state.bedrooms}bed_${state.bathrooms}bath_${state.kitchen}_${state.isDoubleStorey ? 'double' : 'single'}_addons_${layoutAffectingAddons.sort().join('-') || 'none'}_${presetId}`;
};

export const getElevationPresetKey = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons' | 'roof' | 'material'>, presetId: number) => {
  const visualAddons = getElevationVisualAddons(state.addons || []);
  return `${ELEVATION_PRESET_PREFIX}${state.homeType}_${state.bedrooms}bed_${state.bathrooms}bath_${state.kitchen}_${state.isDoubleStorey ? 'double' : 'single'}_roof_${state.roof}_material_${state.material}_addons_${visualAddons.join('-') || 'none'}_${presetId}`;
};

export const getElevationVariantSignature = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons' | 'roof' | 'material'>, presetId: number) => {
  const visualAddons = getElevationVisualAddons(state.addons || []);
  return [
    ELEVATION_VARIANT_VERSION,
    state.homeType,
    `${state.bedrooms}bed`,
    `${state.bathrooms}bath`,
    state.kitchen,
    state.isDoubleStorey ? 'double' : 'single',
    state.roof,
    state.material,
    visualAddons.join(',') || 'none',
    `${presetId}`,
  ].join('|');
};

export const getElevationLookupKeys = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons' | 'roof' | 'material'>, presetId: number) => {
  const exactKey = getElevationPresetKey(state, presetId);
  const rawAddonKey = `${ELEVATION_PRESET_PREFIX}${state.homeType}_${state.bedrooms}bed_${state.bathrooms}bath_${state.kitchen}_${state.isDoubleStorey ? 'double' : 'single'}_roof_${state.roof}_material_${state.material}_addons_${[...(state.addons || [])].sort().join('-') || 'none'}_${presetId}`;
  const legacyBuiltInKey = getBuiltInPresetKey(state, presetId);
  return [exactKey, rawAddonKey, legacyBuiltInKey].filter((key, index, keys) => key && keys.indexOf(key) === index);
};

export const getLegacyFamilyDoubleStoreyPackageKey = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey'>) =>
  `${FAMILY_DOUBLE_STOREY_PACKAGE_KEY}_${state.homeType}_${state.bedrooms}bed_${state.bathrooms}bath_${state.kitchen}_${state.isDoubleStorey ? 'double' : 'single'}`;

export const getFamilyDoubleStoreyPackageKey = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons' | 'layoutStyle'>) => {
  const layoutAddons = getFamilyDoubleStoreyLayoutAddons(state.addons || []);
  return `${getLegacyFamilyDoubleStoreyPackageKey(state)}_style_${state.layoutStyle || 'default'}_addons_${layoutAddons.join('-') || 'none'}`;
};

export const getFamilyDoubleStoreyPackageLookupKeys = (state: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms' | 'kitchen' | 'isDoubleStorey' | 'addons' | 'layoutStyle'>) => {
  const currentKey = getFamilyDoubleStoreyPackageKey(state);
  const layoutAddons = getFamilyDoubleStoreyLayoutAddons(state.addons || []);
  const legacyFallbackKey = `${getLegacyFamilyDoubleStoreyPackageKey(state)}_addons_${layoutAddons.join('-') || 'none'}`;

  // If the user selects a non-default style, they should get a fresh layout or their specific saved one.
  // If they select 'default' (standard), we can fallback to the old key to prevent data loss of past saves.
  if (state.layoutStyle && state.layoutStyle !== 'default') {
     return [currentKey];
  }
  return [currentKey, legacyFallbackKey].filter((key, index, keys) => key && keys.indexOf(key) === index);
};

const inferFamilyDoubleStoreyLayoutAddonsFromPlan = (planData: any): AddOn[] => {
  const groundRooms = Array.isArray(planData?.ground?.rooms) ? planData.ground.rooms : [];
  const firstRooms = Array.isArray(planData?.first?.rooms) ? planData.first.rooms : [];
  const allRooms = [...groundRooms, ...firstRooms];

  const inferred: AddOn[] = [];

  if (allRooms.some((room) => room?.type === 'carport' || `${room?.id || ''}`.includes('carport'))) {
    inferred.push('carport');
  }

  if (allRooms.some((room) => room?.type === 'garden' || `${room?.label || ''}`.toUpperCase().includes('GARDEN') || `${room?.label || ''}`.toUpperCase().includes('TREE'))) {
    inferred.push('landscaping');
  }

  return inferred.sort();
};

export interface ConfigState {
  step: number;
  land: LandChoice;
  landSize: LandSize;
  customLandArea: number;
  homeType: HomeType;
  bedrooms: number;
  bathrooms: number;
  kitchen: KitchenType;
  addons: AddOn[];
  roof: RoofType;
  material: Material;
  // Finishing quality
  finishingQuality: FinishingQuality;
  // Lead
  name: string;
  phone: string;
  email: string;
  timeline: string;
  preferredBranch: string;
  // Kiosk
  kioskMode: boolean;
  // Presets & Custom Editor
  presetId: number; // 0 or 1
  advancedEditorMode: boolean;
  loadedPresetId: string | null;
  // Customization
  customPlan: any | null;
  planHistory: { id: string; label: string; type: string; targetId: string; original: any }[];
  // Double Storey
  isDoubleStorey: boolean;
  activeFloor: 0 | 1 | 2;
  customFirstFloorPlan: any | null;
  savedPresets: any[];
  packageLayouts: Record<string, any>;
  presetOverrides: Record<string, { ground: any; first: any | null }>;
  // Elevation images: keyed by composite preset key, each value is an array of base64 image data URLs
  elevationImages: Record<string, string[]>;
  // Garage shutter state
  garageShutterOpen: boolean;
  // Finance
  downPaymentPercent: number;
  interestRate: number;
  tenureYears: number;
  // Loyalty
  loyaltyProducts: string[];
  propertyPrice: number;
  layoutStyle: LayoutStyle;
}

export interface ConfigActions {
  setStep: (s: number) => void;
  next: () => void;
  prev: () => void;
  setLand: (l: LandChoice) => void;
  setLandSize: (s: LandSize) => void;
  setCustomLandArea: (a: number) => void;
  setHomeType: (h: HomeType) => void;
  setBedrooms: (n: number) => void;
  setBathrooms: (n: number) => void;
  setKitchen: (k: KitchenType) => void;
  toggleAddon: (a: AddOn) => void;
  setRoof: (r: RoofType) => void;
  setFinishingQuality: (q: FinishingQuality) => void;
  setMaterial: (m: Material) => void;
  setLead: (p: Partial<Pick<ConfigState, 'name' | 'phone' | 'email' | 'timeline' | 'preferredBranch'>>) => void;
  setKioskMode: (v: boolean) => void;
  setPresetId: (id: number) => void;
  setAdvancedEditorMode: (v: boolean) => void;
  setCustomPlan: (p: any | null) => void;
  setDoubleStorey: (v: boolean) => void;
  setActiveFloor: (f: 0 | 1 | 2) => void;
  setCustomFirstFloorPlan: (p: any | null) => void;
  setPresetOverride: (presetId: number, groundPlan: any, firstFloorPlan: any | null) => void;
  setPresetOverrides: (overrides: Record<string, { ground: any; first: any | null }>) => void;
  saveBuiltInPreset: (presetId: number, groundPlan: any, firstFloorPlan: any | null) => Promise<void>;
  addHistoryRecord: (record: { label: string; type: string; targetId: string; original: any }) => void;
  removeHistoryRecord: (id: string) => void;
  saveAsPreset: (name: string, groundPlan: any, firstFloorPlan: any) => Promise<any | null>;
  updateSavedPreset: (groundPlan: any, firstFloorPlan: any) => Promise<void>;
  deleteSavedPreset: (index: number) => Promise<void>;
  loadSavedPreset: (index: number) => void;
  fetchSavedPresets: () => Promise<void>;
  fetchPackageLayouts: () => Promise<void>;
  savePackageLayout: (packageKey: string, groundPlan: any, firstFloorPlan: any) => Promise<void>;
  addElevationImage: (presetKey: string, imageDataUrl: string) => void;
  removeElevationImage: (presetKey: string, index: number) => void;
  setGarageShutterOpen: (v: boolean) => void;
  setDownPaymentPercent: (v: number) => void;
  setInterestRate: (v: number) => void;
  setTenureYears: (v: number) => void;
  toggleLoyaltyProduct: (p: string) => void;
  setPropertyPrice: (v: number) => void;
  setLayoutStyle: (s: LayoutStyle) => void;
  reset: () => void;
}

export const HOME_TYPE_DEFAULTS: Record<HomeType, { bedrooms: number; bathrooms: number; baseArea: number; baseCost: number; label: string; areaRange: [number, number] }> = {
  starter: { bedrooms: 2, bathrooms: 1, baseArea: 900, baseCost: 14700000, label: 'Starter', areaRange: [1200, 2400] },
  family: { bedrooms: 3, bathrooms: 2, baseArea: 1400, baseCost: 22050000, label: 'Family', areaRange: [1800, 3600] },
  premium: { bedrooms: 4, bathrooms: 3, baseArea: 2100, baseCost: 25725000, label: 'Executive', areaRange: [2100, 4200] },
  turnkey: { bedrooms: 0, bathrooms: 0, baseArea: 0, baseCost: 350000, label: 'Turn Key', areaRange: [0, 0] },
  young_professional: { bedrooms: 0, bathrooms: 0, baseArea: 0, baseCost: 180000, label: 'Young Professional', areaRange: [0, 0] },
  private_purchase: { bedrooms: 0, bathrooms: 0, baseArea: 0, baseCost: 0, label: 'Private Purchase', areaRange: [0, 0] },
};

export const HOME_TYPE_LIMITS: Record<HomeType, { bedrooms: { min: number; max: number }; bathrooms: { min: number; max: number } }> = {
  starter: { bedrooms: { min: 1, max: 2 }, bathrooms: { min: 1, max: 1 } },
  family: { bedrooms: { min: 2, max: 3 }, bathrooms: { min: 2, max: 3 } },
  premium: { bedrooms: { min: 3, max: 4 }, bathrooms: { min: 3, max: 4 } },
  turnkey: { bedrooms: { min: 0, max: 0 }, bathrooms: { min: 0, max: 0 } },
  young_professional: { bedrooms: { min: 0, max: 0 }, bathrooms: { min: 0, max: 0 } },
  private_purchase: { bedrooms: { min: 0, max: 0 }, bathrooms: { min: 0, max: 0 } },
};

const initial: ConfigState = {
  step: 0,
  land: 'own',
  landSize: null,
  customLandArea: 0,
  homeType: 'family',
  bedrooms: 3,
  bathrooms: 2,
  kitchen: 'open',
  addons: [],
  roof: 'gable',
  finishingQuality: 'standard' as FinishingQuality,
  material: 'modern',
  name: '',
  phone: '+592 ',
  email: '',
  timeline: '',
  preferredBranch: '',
  kioskMode: false,
  presetId: 0,
  advancedEditorMode: false,
  loadedPresetId: null,
  customPlan: null,
  planHistory: [],
  isDoubleStorey: false,
  activeFloor: 2 as 0 | 1 | 2,
  customFirstFloorPlan: null,
  savedPresets: [],
  packageLayouts: {},
  presetOverrides: {},
  elevationImages: {},
  garageShutterOpen: false,
  downPaymentPercent: 10,
  interestRate: 6.5,
  tenureYears: 25,
  loyaltyProducts: [],
  propertyPrice: 0,
  layoutStyle: 'default',
};

export const useConfig = create<ConfigState & ConfigActions>()(
  persist(
    (set, get) => ({
      ...initial,
      setStep: (step) => set({ step }),
      next: () => set({ step: Math.min(get().step + 1, 3) }),
      prev: () => set({ step: Math.max(get().step - 1, 0) }),
      setLand: (land) => set(land === 'own' ? { land, landSize: null, customLandArea: 0 } : { land }),
      setLandSize: (landSize) => set({ landSize }),
      setCustomLandArea: (customLandArea) => set({ customLandArea }),
      setHomeType: (homeType) => {
        const d = HOME_TYPE_DEFAULTS[homeType];
        set({ homeType, bedrooms: d.bedrooms, bathrooms: d.bathrooms, presetId: 0, loadedPresetId: null, customPlan: null, isDoubleStorey: false, activeFloor: 2, customFirstFloorPlan: null });
      },
      setBedrooms: (bedrooms) => set((state) => {
        const limits = HOME_TYPE_LIMITS[state.homeType].bedrooms;
        return {
          bedrooms: Math.max(limits.min, Math.min(limits.max, bedrooms)),
          customPlan: null,
          customFirstFloorPlan: null,
        };
      }),
      setBathrooms: (bathrooms) => set((state) => {
        const limits = HOME_TYPE_LIMITS[state.homeType].bathrooms;
        return {
          bathrooms: Math.max(limits.min, Math.min(limits.max, bathrooms)),
          customPlan: null,
          customFirstFloorPlan: null,
        };
      }),
      setKitchen: (kitchen) => set({
        kitchen,
        customPlan: null,
        customFirstFloorPlan: null,
      }),
      toggleAddon: (a) => set((s) => {
        const newAddons = s.addons.includes(a) ? s.addons.filter((x) => x !== a) : [...s.addons, a];
        // Only carport physically reshapes the floor plan — clear the custom plan so the
        // correct layout is regenerated. All other addons (including landscaping / "Furniture",
        // solar, water_tank, fence, smart_home) are visual-only and must NOT reset the layout.
        const isLayoutAffecting = a === 'carport';
        return {
          addons: newAddons,
          ...(isLayoutAffecting ? { customPlan: null, customFirstFloorPlan: null } : {}),
        };
      }),
      setRoof: (roof) => set({ roof }),
      setFinishingQuality: (finishingQuality) => set({ finishingQuality }),
      setMaterial: (material) => set({ material }),
      setLead: (p) => set((s) => ({ ...s, ...p })),
      setKioskMode: (kioskMode) => set({ kioskMode }),
      setPresetId: (presetId) => set({ presetId, customPlan: null, loadedPresetId: null }),
      setAdvancedEditorMode: (advancedEditorMode) => set({ advancedEditorMode }),
      setCustomPlan: (customPlan) => set({ customPlan }),
      setDoubleStorey: (isDoubleStorey) => set({ isDoubleStorey, activeFloor: isDoubleStorey ? 2 : 0, customPlan: null, customFirstFloorPlan: null }),
      setActiveFloor: (activeFloor) => set({ activeFloor }),
      setCustomFirstFloorPlan: (customFirstFloorPlan) => set({ customFirstFloorPlan }),
      setPresetOverride: (presetId, groundPlan, firstFloorPlan) => set((s) => ({
        ...s,
        presetOverrides: {
          ...s.presetOverrides,
          [getBuiltInPresetKey(s, presetId)]: { ground: groundPlan, first: firstFloorPlan },
        },
      })),
      setPresetOverrides: (presetOverrides) => set({ presetOverrides }),
      saveBuiltInPreset: async (presetId, groundPlan, firstFloorPlan) => {
        const state = get();
        const key = getBuiltInPresetKey(state, presetId);
        const fullPlan = { ground: groundPlan, first: firstFloorPlan };
        set((s) => ({
          presetOverrides: {
            ...s.presetOverrides,
            [key]: { ground: groundPlan, first: firstFloorPlan },
          },
        }));

        const { data: existing, error: selectError } = await supabase
          .from('presets')
          .select('id')
          .eq('name', key)
          .maybeSingle();

        if (selectError) {
          throw selectError;
        }

        if (existing?.id) {
          const { error } = await supabase
            .from('presets')
            .update({ plan_data: fullPlan as any })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('presets')
            .insert({ name: key, plan_data: fullPlan as any });
          if (error) throw error;
        }
      },
      addHistoryRecord: (record) => set((s) => {
        // Prevent duplicate history for same target/type if possible, or just append
        const id = Math.random().toString(36).substr(2, 9);
        return { planHistory: [...s.planHistory, { ...record, id }] };
      }),
      removeHistoryRecord: (id) => set((s) => ({ planHistory: s.planHistory.filter(r => r.id !== id) })),
      fetchSavedPresets: async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rawData, error } = await (supabase.rpc as any)('get_presets') as { data: any[]; error: any };
        const data = rawData ?? [];
        if (!error && data) {
          const state = get();
          const builtInRows = data.filter((row) => row.name?.startsWith(BUILT_IN_PRESET_PREFIX));
          const dbOverrides = builtInRows.reduce<Record<string, { ground: any; first: any | null }>>((acc, row) => {
            const presetId = Number(row.name.slice(row.name.lastIndexOf('_') + 1));
            const planData = row.plan_data as any;
            if ((presetId === 0 || presetId === 1) && planData?.ground?.rooms) {
              acc[row.name] = { ground: planData.ground, first: planData.first || null };
            }
            return acc;
          }, {});
          // Merge DB overrides with existing local overrides instead of replacing.
          // This preserves locally-set overrides (e.g. family double-storey packages
          // stored in package_layouts) that aren't present in the presets table.
          const mergedOverrides = { ...state.presetOverrides, ...dbOverrides };
          set({ savedPresets: data.filter((row) => !row.name?.startsWith(BUILT_IN_PRESET_PREFIX)), presetOverrides: mergedOverrides });
        }
      },
      fetchPackageLayouts: async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('get_package_layouts') as { data: any[]; error: any };
        if (!error && data) {
          const state = get();
          const packageLayouts = data.reduce<Record<string, any>>((acc, row) => {
            acc[row.package_key] = row.plan_data;

            if (
              typeof row.package_key === 'string' &&
              row.package_key.startsWith(`${FAMILY_DOUBLE_STOREY_PACKAGE_KEY}_`) &&
              !row.package_key.includes('_addons_')
            ) {
              const inferredAddons = inferFamilyDoubleStoreyLayoutAddonsFromPlan(row.plan_data);
              const normalizedKey = `${row.package_key}_addons_${inferredAddons.join('-') || 'none'}`;
              if (!acc[normalizedKey]) {
                acc[normalizedKey] = row.plan_data;
              }
            }

            return acc;
          }, {});
          set({ packageLayouts: { ...state.packageLayouts, ...packageLayouts } });
        }
      },
      savePackageLayout: async (packageKey, groundPlan, firstFloorPlan) => {
        const fullPlan = { ground: groundPlan, first: firstFloorPlan };
        set((s) => ({
          packageLayouts: {
            ...s.packageLayouts,
            [packageKey]: fullPlan,
          },
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.rpc as any)('upsert_package_layout', { p_package_key: packageKey, p_plan_data: fullPlan });
      },
      saveAsPreset: async (name, groundPlan, firstFloorPlan) => {
        const fullPlan = { ground: groundPlan, first: firstFloorPlan };
        const presetName = name.trim() || `Custom Preset ${get().savedPresets.length + 1}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('save_preset', { p_name: presetName, p_plan_data: fullPlan }) as { data: any; error: any };

        if (error) {
          throw error;
        }

        if (data) {
          set({
            presetId: -1,
            loadedPresetId: data.id,
            customPlan: groundPlan,
            customFirstFloorPlan: firstFloorPlan,
          });
          await get().fetchSavedPresets();
        }

        return data ?? null;
      },
      updateSavedPreset: async (groundPlan, firstFloorPlan) => {
        const state = get();
        const fullPlan = { ground: groundPlan, first: firstFloorPlan };
        set({ customPlan: groundPlan, customFirstFloorPlan: firstFloorPlan });
        
        if (state.loadedPresetId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.rpc as any)('update_preset', { p_id: state.loadedPresetId, p_plan_data: fullPlan });
          await state.fetchSavedPresets();
        } else {
          await state.saveAsPreset('Updated Preset', groundPlan, firstFloorPlan);
        }
      },
      deleteSavedPreset: async (index) => {
        const state = get();
        const target = state.savedPresets[index];
        if (target && target.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.rpc as any)('delete_preset', { p_id: target.id });
        }
        set((s) => {
          const isDeletingLoaded = s.loadedPresetId === target?.id;
          return {
            savedPresets: s.savedPresets.filter((_, i) => i !== index),
            ...(isDeletingLoaded ? { presetId: 0, loadedPresetId: null, customPlan: null, customFirstFloorPlan: null } : {})
          };
        });
      },
      loadSavedPreset: (index) => set((s) => {
        const dbData = s.savedPresets[index]?.plan_data;
        if (!dbData) return s;
        
        const ground = dbData.ground || dbData;
        const first = dbData.first || null;
        
        // Ensure ground has required structure
        const safeGround = ground && ground.rooms ? ground : { width: 0, height: 0, rooms: [] };
        const safeFirst = first && first.rooms ? first : null;
        
        const hasFirstFloor = safeFirst && safeFirst.rooms && safeFirst.rooms.length > 0;
        return { 
          customPlan: safeGround, 
          customFirstFloorPlan: safeFirst, 
          loadedPresetId: s.savedPresets[index].id, 
          presetId: -1,
          isDoubleStorey: hasFirstFloor ? true : s.isDoubleStorey
        };
      }),
      addElevationImage: (presetKey, imageDataUrl) => set((s) => ({
        elevationImages: {
          ...s.elevationImages,
          [presetKey]: [...(s.elevationImages[presetKey] || []), imageDataUrl],
        },
      })),
      removeElevationImage: (presetKey, index) => set((s) => ({
        elevationImages: {
          ...s.elevationImages,
          [presetKey]: (s.elevationImages[presetKey] || []).filter((_, i) => i !== index),
        },
      })),
      setGarageShutterOpen: (v) => set({ garageShutterOpen: v }),
      setDownPaymentPercent: (v) => set({ downPaymentPercent: v }),
      setInterestRate: (v) => set({ interestRate: v }),
      setTenureYears: (v) => set({ tenureYears: v }),
      setPropertyPrice: (v) => set({ propertyPrice: v }),
      setLayoutStyle: (layoutStyle) => set({ layoutStyle, customPlan: null, customFirstFloorPlan: null }),
      toggleLoyaltyProduct: (p) => set((state) => ({ loyaltyProducts: state.loyaltyProducts.includes(p) ? state.loyaltyProducts.filter(x => x !== p) : [...state.loyaltyProducts, p] })),
      reset: () => set((state) => ({
        ...initial,
        savedPresets: state.savedPresets,
        packageLayouts: state.packageLayouts,
        presetOverrides: state.presetOverrides,
        elevationImages: state.elevationImages,
      })),
    }),
    {
      name: 'gbti-configurator',
      // Exclude packageLayouts from localStorage so it always fetches fresh
      // from Supabase on every page load. This prevents stale cache conflicts
      // between local dev and deployed environments.
      partialize: (state) => {
        const { packageLayouts, ...rest } = state;
        return rest;
      },
    }
  )
);
