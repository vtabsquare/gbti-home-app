/**
 * Dynamic pricing hook — fetches admin-configured pricing from Supabase
 * and provides a computeCost function that uses those prices.
 * Falls back to hardcoded defaults when no admin settings exist.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { AddOn, ConfigState, HomeType, KitchenType } from '@/store/configurator';

// ── Default (hardcoded) pricing — same as original cost.ts values ──────────

export interface PricingConfig {
  sqft_rate: number;
  land_sqft_rate: number;
  flat_land_cost: number;
  bedroom_cost: number;
  bathroom_cost: number;
  home_types: Record<HomeType, { baseCost: number; baseArea: number }>;
  kitchen_costs: Record<KitchenType, number>;
  addon_costs: Record<AddOn, number>;
  turnkey_cost: number;
  young_professional_cost: number;
  finishing_costs: Record<'starter' | 'family' | 'premium', {
    standard_1storey: number;
    premium_1storey: number;
    standard_2storey: number;
    premium_2storey: number;
  }>;
}

// Addons that are included in total estimate but NOT in the loan amount
export const NON_LOAN_ADDONS: AddOn[] = ['solar', 'water_tank', 'smart_home'];

const DEFAULTS: PricingConfig = {
  sqft_rate: 145,
  land_sqft_rate: 75,
  flat_land_cost: 50000,
  bedroom_cost: 0,   // bedrooms affect layout only, not pricing
  bathroom_cost: 0,  // bathrooms affect layout only, not pricing
  home_types: {
    starter: { baseCost: 135000, baseArea: 900 },
    family: { baseCost: 245000, baseArea: 1400 },
    premium: { baseCost: 410000, baseArea: 2100 },
    turnkey: { baseCost: 350000, baseArea: 0 },
    young_professional: { baseCost: 180000, baseArea: 0 },
    private_purchase: { baseCost: 0, baseArea: 0 },
  },
  kitchen_costs: { standard: 0, open: 0, galley: 0 }, // kitchen affects layout only, not pricing
  addon_costs: {
    solar: 100000,        // in total, NOT in loan
    carport: 0,           // layout/visual only, no price
    water_tank: 18000,    // in total, NOT in loan
    smart_home: 300000,   // Generator — in total, NOT in loan
    fence: 2500000,       // Perimeter Fence/Bridge — in total AND in loan
    landscaping: 2000000, // Furniture — in total AND in loan
  },
  turnkey_cost: 350000,
  young_professional_cost: 180000,
  finishing_costs: {
    starter: {
      standard_1storey: 14700000,
      premium_1storey: 19866000,
      standard_2storey: 24110400,
      premium_2storey: 32580000,
    },
    family: {
      standard_1storey: 22050000,
      premium_1storey: 29799000,
      standard_2storey: 36165600,
      premium_2storey: 48870000,
    },
    premium: {
      standard_1storey: 25725000,
      premium_1storey: 34765500,
      standard_2storey: 42193200,
      premium_2storey: 57015000,
    },
  },
};

const ADDON_LABELS: Record<AddOn, string> = {
  solar: 'Solar Panels *',
  carport: 'Carport',
  water_tank: 'Water Tank *',
  smart_home: 'Generator *',
  fence: 'Perimeter Fence/Bridge',
  landscaping: 'Furniture',
};

export const LAND_PACKAGES_STATIC: Record<'small' | 'medium' | 'large', { label: string; range: [number, number]; baseArea: number; description: string }> = {
  small:  { label: '800–1000',  range: [800, 1000],  baseArea: 900,  description: 'Smart starter footprint with everything essential. Perfect first build.' },
  medium: { label: '1200–1600', range: [1200, 1600], baseArea: 1400, description: 'The benchmark family layout. Open social spaces, generous bedrooms.' },
  large:  { label: '1800–2400', range: [1800, 2400], baseArea: 2100, description: 'Architectural footprint with multi-zone living and double-height options.' },
};

export interface CostBreakdown {
  area: number;
  baseStructure: number;
  bedroomCost: number;
  bathroomCost: number;
  kitchenCost: number;
  addonsCost: number;
  nonLoanAddonsCost: number;  // addons in total but excluded from loan
  landCost: number;
  total: number;
  downPayment: number;
  loanAmount: number;
  emi: number;
  items: { label: string; amount: number }[];
  downPaymentPercent: number;
}

// ── Merge admin-saved pricing with defaults ─────────────────────────────────

function mergePricing(saved: any): PricingConfig {
  if (!saved) return DEFAULTS;
  return {
    sqft_rate: saved.sqft_rate ?? DEFAULTS.sqft_rate,
    land_sqft_rate: saved.land_sqft_rate ?? DEFAULTS.land_sqft_rate,
    flat_land_cost: saved.flat_land_cost ?? DEFAULTS.flat_land_cost,
    bedroom_cost: 0,   // always 0 — bedrooms are layout-only
    bathroom_cost: 0,  // always 0 — bathrooms are layout-only
    home_types: {
      starter: { ...DEFAULTS.home_types.starter, ...saved.home_types?.starter },
      family: { ...DEFAULTS.home_types.family, ...saved.home_types?.family },
      premium: { ...DEFAULTS.home_types.premium, ...saved.home_types?.premium },
      turnkey: { ...DEFAULTS.home_types.turnkey, ...saved.home_types?.turnkey },
      young_professional: { ...DEFAULTS.home_types.young_professional, ...saved.home_types?.young_professional },
      private_purchase: { ...DEFAULTS.home_types.private_purchase, ...saved.home_types?.private_purchase },
    },
    kitchen_costs: { standard: 0, open: 0, galley: 0 }, // always 0 — kitchen is layout-only
    addon_costs: { ...DEFAULTS.addon_costs, ...saved.addon_costs },
    turnkey_cost: saved.turnkey_cost ?? DEFAULTS.turnkey_cost,
    young_professional_cost: saved.young_professional_cost ?? DEFAULTS.young_professional_cost,
    finishing_costs: {
      starter: { ...DEFAULTS.finishing_costs.starter, ...saved.finishing_costs?.starter },
      family: { ...DEFAULTS.finishing_costs.family, ...saved.finishing_costs?.family },
      premium: { ...DEFAULTS.finishing_costs.premium, ...saved.finishing_costs?.premium },
    },
  };
}

// ── Compute cost with a given pricing config ────────────────────────────────

function computeArea(c: Pick<ConfigState, 'homeType' | 'bedrooms' | 'bathrooms'>, p: PricingConfig) {
  const base = p.home_types[c.homeType].baseArea;
  const defaultBed = c.homeType === 'starter' ? 2 : c.homeType === 'family' ? 3 : 4;
  const defaultBath = c.homeType === 'starter' ? 1 : c.homeType === 'family' ? 2 : 3;
  const extraBed = Math.max(0, c.bedrooms - defaultBed) * 130;
  const extraBath = Math.max(0, c.bathrooms - defaultBath) * 60;
  return base + extraBed + extraBath;
}

export function computeCostDynamic(c: ConfigState, p: PricingConfig, opts: { interestRate?: number; tenureYears?: number } = {}): CostBreakdown {
  const interestRate = c.interestRate / 100;
  const tenureYears = c.tenureYears;

  let area = 0;
  let baseStructure = 0;
  const bedroomCost = 0;   // layout only
  const bathroomCost = 0;  // layout only
  const kitchenCost = 0;   // layout only
  let addonsCost = 0;
  let nonLoanAddonsCost = 0;
  let landCost = 0;
  let items: { label: string; amount: number }[] = [];

  if (c.homeType === 'turnkey' || c.homeType === 'young_professional' || c.homeType === 'private_purchase') {
    // Fixed price flows
    baseStructure = c.propertyPrice;
    const label = c.homeType === 'turnkey' ? 'Turnkey Build Package' : c.homeType === 'private_purchase' ? 'Private Purchase' : 'Young Professional Package';
    items = [
      { label, amount: baseStructure }
    ];
  } else {
    // Standard modular pricing
    area = computeArea(c, p);
    const includedArea = p.home_types[c.homeType].baseArea;
    const extraArea = Math.max(0, area - includedArea);
    
    // Determine finishing quality cost
    const finishKey = c.homeType as 'starter' | 'family' | 'premium';
    const finishConfig = p.finishing_costs[finishKey];
    const finishingQuality = c.finishingQuality || 'standard';
    const is2Storey = c.isDoubleStorey;
    
    if (finishingQuality === 'premium') {
      baseStructure = is2Storey ? finishConfig.premium_2storey : finishConfig.premium_1storey;
    } else {
      baseStructure = is2Storey ? finishConfig.standard_2storey : finishConfig.standard_1storey;
    }
    
    // Add extra area cost on top of the flat finishing cost
    baseStructure += extraArea * p.sqft_rate;
    
    // Compute addons — separating non-loan addons
    addonsCost = c.addons.reduce((sum, a) => sum + (p.addon_costs[a] || 0), 0);
    nonLoanAddonsCost = c.addons
      .filter((a) => NON_LOAN_ADDONS.includes(a))
      .reduce((sum, a) => sum + (p.addon_costs[a] || 0), 0);

    landCost = c.land === 'need' ? p.flat_land_cost : 0;
    
    const finishLabel = finishingQuality === 'premium' ? 'Premium' : 'Standard';
    const storeyLabel = is2Storey ? '2 Storey' : '1 Storey';
    items = [
      { label: `Base structure · ${finishLabel} · ${storeyLabel} · ${area} sqft`, amount: baseStructure },
      ...c.addons
        .filter((a) => (p.addon_costs[a] || 0) > 0)
        .map((a) => ({ label: ADDON_LABELS[a] || a, amount: p.addon_costs[a] || 0 })),
    ];
    if (landCost) items.push({ label: 'Land package', amount: landCost });
  }

  // Total includes ALL addons (including non-loan ones)
  const total = Math.round(baseStructure + bedroomCost + bathroomCost + kitchenCost + addonsCost + landCost);
  const downPayment = Math.round(total * (c.downPaymentPercent / 100));
  
  // Loan excludes non-loan addons (solar, water_tank, generator)
  const loanBase = Math.max(0, total - nonLoanAddonsCost);
  const loanAmount = loanBase - Math.round(loanBase * (c.downPaymentPercent / 100));

  const r = interestRate / 12;
  const n = tenureYears * 12;
  const emi = Math.round((loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

  return { area, baseStructure, bedroomCost, bathroomCost, kitchenCost, addonsCost, nonLoanAddonsCost, landCost, total, downPayment, loanAmount, emi, items, downPaymentPercent: c.downPaymentPercent };
}

// ── React Hook ──────────────────────────────────────────────────────────────

export function useDynamicPricing() {
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const fetchedRef = useRef(false);

  const fetchPricing = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('get_pricing') as { data: any; error: any };
      if (!error && data?.value) {
        setPricing(mergePricing(data.value));
      }
    } catch {
      // api.get_pricing not yet available — use defaults
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchPricing();
    }
  }, [fetchPricing]);

  return { pricing, loaded };
}

// ── Re-export formatMoney for convenience ───────────────────────────────────

export function formatMoneyDynamic(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
