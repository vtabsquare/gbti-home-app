import { useConfig, AddOn, KitchenType, HOME_TYPE_LIMITS, type FinishingQuality } from '@/store/configurator';
import { StepShell } from '../StepShell';
import { formatMoney } from '@/lib/cost';
import { useAddonMeta, useKitchenMeta, useRoomPricingMeta, usePricing } from '@/hooks/PricingContext';
import { Minus, Plus, Sun, Car, Droplets, Cpu, Fence, Trees, LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ADDON_ICON: Record<AddOn, LucideIcon> = {
  solar: Sun,
  carport: Car,
  water_tank: Droplets,
  smart_home: Cpu,
  fence: Fence,
  landscaping: Trees,
};

const KITCHENS: { id: KitchenType; label: string; desc: string }[] = [
  { id: 'standard', label: 'Standard', desc: 'Closed kitchen with separate dining' },
  { id: 'open', label: 'Open Plan', desc: 'Merged kitchen + living + dining' },
];

export const StepFeatures = () => {
  const { homeType, bedrooms, bathrooms, kitchen, addons, isDoubleStorey, finishingQuality, setDoubleStorey, setFinishingQuality, setBedrooms, setBathrooms, setKitchen, toggleAddon, next, prev } = useConfig();
  const ADDON_META = useAddonMeta();
  const KITCHEN_META = useKitchenMeta();
  const { bedroomCost, bathroomCost } = useRoomPricingMeta();
  const pricing = usePricing();
  const bedroomLimits = HOME_TYPE_LIMITS[homeType].bedrooms;
  const bathroomLimits = HOME_TYPE_LIMITS[homeType].bathrooms;

  // Compute upgrade cost for premium vs standard
  const finishKey = homeType as 'starter' | 'family' | 'premium';
  const finishConfig = pricing.finishing_costs?.[finishKey];
  const standardCost = finishConfig
    ? (isDoubleStorey ? finishConfig.standard_2storey : finishConfig.standard_1storey)
    : 0;
  const premiumCost = finishConfig
    ? (isDoubleStorey ? finishConfig.premium_2storey : finishConfig.premium_1storey)
    : 0;
  const upgradeDiff = premiumCost - standardCost;

  const showFinishingToggle = homeType === 'starter' || homeType === 'family' || homeType === 'premium';

  return (
    <StepShell
      eyebrow="Step 03 · Configuration"
      title="Define the details."
      subtitle="Adjust room counts, explore spatial layouts, and select architectural enhancements."
      onNext={next}
      onPrev={prev}
    >
      <div className="space-y-3">
        {/* ── Floor Plan Layout ─────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-display text-xl font-normal tracking-tight text-foreground/80">Floor Plan Layout</h3>
            <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40 font-bold hidden sm:inline-block">Base</span>
          </div>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2">
            {[
              { id: false, label: 'Flat', desc: 'Single-storey home design' },
              { id: true, label: 'Multi-Storey', desc: 'Multi-Storey home design' }
            ].map((k) => {
              const active = isDoubleStorey === k.id;
              const disabled = homeType === 'starter' && k.id === true;
              return (
                <button
                  key={k.label}
                  onClick={() => { if (!disabled) setDoubleStorey(k.id); }}
                  disabled={disabled}
                  className={`group relative overflow-hidden rounded-xl p-2 sm:p-3 text-left transition-all duration-500 border ${
                    disabled
                      ? 'bg-surface/30 border-border/50 opacity-50 cursor-not-allowed'
                      : active 
                        ? 'bg-surface shadow-elev border-clay/30 scale-[1.02]' 
                        : 'bg-surface/50 border-border hover:border-muted-foreground/20 hover:bg-surface hover:shadow-soft'
                  }`}
                >
                  <div className="relative z-10 flex items-center justify-between mb-2">
                    <span className={`font-display font-medium tracking-tight text-base ${active ? 'text-foreground' : 'text-foreground/80'}`}>
                      {k.label} {disabled && <span className="text-[10px] text-muted-foreground ml-2">(Not available)</span>}
                    </span>
                    {active && <div className="h-1.5 w-1.5 rounded-full bg-clay" />}
                  </div>
                  <p className="relative z-10 text-[11px] text-muted-foreground leading-relaxed font-light">{k.desc}</p>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Finish Quality ────────────────────────────────── */}
        {showFinishingToggle && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-display text-xl font-normal tracking-tight text-foreground/80">Finish Quality</h3>
              <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40 font-bold">Quality</span>
            </div>
            <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2">
              {([
                { id: 'standard' as FinishingQuality, label: 'Standard', desc: 'Quality finishes at an accessible price point', price: standardCost },
                { id: 'premium' as FinishingQuality, label: '★ Premium', desc: 'Elevated materials, premium fixtures and refined detailing', price: premiumCost },
              ]).map((k) => {
                const active = finishingQuality === k.id;
                return (
                  <button
                    key={k.id}
                    onClick={() => setFinishingQuality(k.id)}
                    className={`group relative overflow-hidden rounded-xl p-2 sm:p-3 text-left transition-all duration-500 border ${
                      active
                        ? k.id === 'premium'
                          ? 'bg-amber-50/30 shadow-elev border-amber-200/50 scale-[1.02]'
                          : 'bg-surface shadow-elev border-clay/30 scale-[1.02]'
                        : 'bg-surface/50 border-border hover:border-muted-foreground/20 hover:bg-surface hover:shadow-soft'
                    }`}
                  >
                    <div className="relative z-10 flex items-center justify-between mb-2">
                      <span className={`font-display font-medium tracking-tight text-base ${active ? (k.id === 'premium' ? 'text-amber-700' : 'text-foreground') : 'text-foreground/80'}`}>{k.label}</span>
                      <div className="flex items-center gap-2">
                        {k.price > 0 && (
                          <span className={`text-[10px] font-bold uppercase tracking-widest num ${active && k.id === 'premium' ? 'text-amber-600' : 'text-clay'}`}>
                            {formatMoney(k.price)}
                          </span>
                        )}
                        {active && <div className={`h-1.5 w-1.5 rounded-full ${k.id === 'premium' ? 'bg-amber-500' : 'bg-clay'}`} />}
                      </div>
                    </div>
                    <p className="relative z-10 text-[11px] text-muted-foreground leading-relaxed font-light">{k.desc}</p>
                    {!active && k.id === 'premium' && upgradeDiff > 0 && (
                      <p className="relative z-10 text-[9px] text-amber-600/70 font-medium mt-1">+{formatMoney(upgradeDiff)} upgrade</p>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Bedrooms & Bathrooms ──────────────────────────── */}
        <div className="grid gap-2 sm:gap-4 grid-cols-1 sm:grid-cols-2">
          <Stepper
            label="Bedrooms"
            value={bedrooms}
            onChange={setBedrooms}
            min={bedroomLimits.min}
            max={bedroomLimits.max}
            hint="Min 10×10 ft"
            note={bedroomLimits.min === bedroomLimits.max ? `Fixed at ${bedroomLimits.min}` : `${bedroomLimits.min} to ${bedroomLimits.max}`}
          />
          <Stepper
            label="Bathrooms"
            value={bathrooms}
            onChange={setBathrooms}
            min={bathroomLimits.min}
            max={bathroomLimits.max}
            hint="Min 5×7 ft"
            note={bathroomLimits.min === bathroomLimits.max ? `Fixed at ${bathroomLimits.min}` : `${bathroomLimits.min} to ${bathroomLimits.max}`}
          />
        </div>

        {/* ── Spatial Layout ────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-display text-xl font-normal tracking-tight text-foreground/80">Spatial Layout</h3>
            <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40 font-bold">Options</span>
          </div>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2">
            {KITCHENS.map((k) => {
              const active = kitchen === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => setKitchen(k.id)}
                  className={`group relative overflow-hidden rounded-xl p-2 sm:p-3 text-left transition-all duration-500 border ${
                    active 
                      ? 'bg-surface shadow-elev border-clay/30 scale-[1.02]' 
                      : 'bg-surface/50 border-border hover:border-muted-foreground/20 hover:bg-surface hover:shadow-soft'
                  }`}
                >
                  <div className="relative z-10 flex items-center justify-between mb-2">
                    <span className={`font-display font-medium tracking-tight text-base ${active ? 'text-foreground' : 'text-foreground/80'}`}>{k.label}</span>
                    {active && <div className="h-1.5 w-1.5 rounded-full bg-clay" />}
                  </div>
                  <p className="relative z-10 text-[11px] text-muted-foreground leading-relaxed font-light">{k.desc}</p>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Enhancements ─────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-display text-xl font-normal tracking-tight text-foreground/80">Enhancements</h3>
            <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40 font-bold">Optional</span>
          </div>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(ADDON_META) as AddOn[]).map((id) => {
              const meta = ADDON_META[id];
              const Icon = ADDON_ICON[id];
              const active = addons.includes(id);
              const showAsterisk = meta.isNonLoan;
              const displayLabel = meta.label + (showAsterisk ? ' *' : '');
              return (
                <motion.button
                  key={id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => toggleAddon(id)}
                  className={`group relative overflow-hidden flex flex-col sm:flex-row items-center sm:items-start gap-1.5 sm:gap-2 rounded-xl p-2 sm:p-3 text-center sm:text-left transition-all duration-500 border ${
                    active 
                      ? 'bg-surface shadow-elev border-clay/30' 
                      : 'bg-surface/50 border-border hover:border-muted-foreground/20 hover:bg-surface hover:shadow-soft'
                  }`}
                >
                  <div className={`relative z-10 flex shrink-0 h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-md sm:rounded-lg border transition-colors duration-500 ${active ? 'bg-clay border-clay text-white shadow-sm' : 'bg-soft-section border-border text-muted-foreground'}`}>
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" strokeWidth={1.25} />
                  </div>
                  <div className="relative z-10 flex-1 min-w-0 w-full flex flex-col items-center sm:items-start">
                    <div className={`font-medium tracking-tight text-[10px] leading-tight sm:text-sm truncate w-full ${active ? 'text-foreground' : 'text-foreground/80'}`}>{meta.label}{showAsterisk && <span className="text-clay ml-0.5">*</span>}</div>
                    {meta.layoutOnly ? (
                      <div className="text-[8px] sm:text-[10px] uppercase tracking-widest text-muted-foreground/50 mt-0.5 sm:mt-1">Layout only</div>
                    ) : (
                      <div className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-clay num mt-0.5 sm:mt-1">+{formatMoney(meta.cost)}</div>
                    )}
                  </div>
                  {active && (
                    <div className="absolute top-1.5 right-1.5 sm:relative sm:top-0 sm:right-0 z-10 h-1.5 w-1.5 rounded-full bg-clay shrink-0" />
                  )}
                </motion.button>
              );
            })}
          </div>
          {/* Non-loan disclaimer */}
          <p className="mt-3 text-[9px] text-muted-foreground/60 leading-relaxed border-t border-border/40 pt-3">
            <span className="text-clay font-semibold">*</span> Price is included in the total estimate, but not included in the total loan amount due to ineligibility for bank financing.
          </p>
        </motion.div>
      </div>
    </StepShell>
  );
};

const Stepper = ({
  label, value, onChange, min, max, hint, note,
}: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string; note?: string }) => (
  <div className="relative rounded-xl bg-surface border border-border p-2 sm:p-3 shadow-soft transition-all hover:shadow-soft group">
    <div className="flex items-baseline justify-between mb-2">
      <span className="font-display text-base tracking-tight text-foreground/80 font-normal">{label}</span>
      <div className="flex items-center gap-2">
        {hint && <span className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/40 font-bold">{hint}</span>}
      </div>
    </div>
    <div className="flex items-center justify-between bg-soft-section/50 rounded-lg p-1.5 border border-border/50">
      <button
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-surface border border-border shadow-sm hover:bg-soft-section disabled:opacity-30 transition-all active:scale-95"
      >
        <Minus size={14} className="text-foreground" strokeWidth={1.5} />
      </button>
      
      <div className="relative h-8 flex-1 flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={value}
            initial={{ y: -15, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 15, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-xl font-normal num tracking-tight"
          >
            {value}
          </motion.div>
        </AnimatePresence>
      </div>

      <button
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-lg hover:brightness-110 disabled:opacity-30 transition-all active:scale-95"
      >
        <Plus size={14} strokeWidth={1.5} />
      </button>
    </div>
    {note && (
      <div className="mt-2 text-center text-[9px] uppercase tracking-[0.2em] text-muted-foreground/40 font-bold">
        {note}
      </div>
    )}
  </div>
);
