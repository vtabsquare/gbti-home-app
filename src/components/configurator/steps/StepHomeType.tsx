import { useEffect } from 'react';
import { useConfig, HomeType, LandSize } from '@/store/configurator';
import { StepShell } from '../StepShell';
import { formatMoney } from '@/lib/cost';
import { useHomeTypeMeta, useLandSqftRate, useLandPackages } from '@/hooks/PricingContext';
import { motion } from 'framer-motion';

const TYPES: { id: HomeType; tag: string; desc: string; popular?: boolean }[] = [
  { id: 'starter', tag: 'Compact + Efficient', desc: 'Smart starter footprint with everything essential. Perfect first build.' },
  { id: 'family', tag: 'Most Popular', desc: 'The benchmark family layout. Open social spaces, generous bedrooms.', popular: true },
  { id: 'premium', tag: 'Spacious + Airy', desc: 'Architectural footprint with multi-zone living and generous double-height options.' },
];

const PACKAGE_IDS: { id: Exclude<LandSize, 'custom' | null>; tag: string }[] = [
  { id: 'small', tag: 'Compact + efficient' },
  { id: 'medium', tag: 'Most popular' },
  { id: 'large', tag: 'Spacious + premium' },
];

/* ── House silhouette SVG — matches reference image ──────────── */
const HouseSilhouette = ({ type, active }: { type: HomeType; active: boolean }) => {
  const isFamily = type === 'family';
  const isPremium = type === 'premium';

  return (
    <svg
      width={isPremium ? 90 : isFamily ? 76 : 60}
      height="40"
      viewBox="0 0 90 42"
      fill="none"
      className={`flex-shrink-0 transition-all duration-500 ${active ? 'opacity-100' : 'opacity-25'}`}
    >
      {isPremium ? (
        /* Premium — wide two-section house with taller profile */
        <>
          <path
            d="M5 34V20L30 8L55 20V34H5Z"
            stroke={active ? 'hsl(var(--clay))' : 'currentColor'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M50 34V22L72 12L85 19V34H50Z"
            stroke={active ? 'hsl(var(--clay))' : 'currentColor'}
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="0" y1="34" x2="90" y2="34" stroke={active ? 'hsl(var(--clay))' : 'currentColor'} strokeWidth="1" />
        </>
      ) : isFamily ? (
        /* Family — medium wider house */
        <>
          <path
            d="M8 34V19L38 7L68 19V34H8Z"
            stroke={active ? 'hsl(var(--clay))' : 'currentColor'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="0" y1="34" x2="76" y2="34" stroke={active ? 'hsl(var(--clay))' : 'currentColor'} strokeWidth="1" />
        </>
      ) : (
        /* Starter — compact smaller house */
        <>
          <path
            d="M10 34V21L30 11L50 21V34H10Z"
            stroke={active ? 'hsl(var(--clay))' : 'currentColor'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="0" y1="34" x2="60" y2="34" stroke={active ? 'hsl(var(--clay))' : 'currentColor'} strokeWidth="1" />
        </>
      )}
    </svg>
  );
};

export const StepHomeType = () => {
  const {
    land,
    setLand,
    landSize,
    setLandSize,
    customLandArea,
    setCustomLandArea,
    homeType,
    setHomeType,
    next,
    prev
  } = useConfig();

  const HOME_TYPE_META = useHomeTypeMeta();
  const LAND_SQFT_RATE = useLandSqftRate();
  const LAND_PACKAGES = useLandPackages();

  // Session state healing hook
  useEffect(() => {
    if (land === null) {
      setLand('own');
    }
  }, [land, setLand]);

  const canProceed = land !== null;

  return (
    <StepShell
      eyebrow="Step 01 · Planning & Selection"
      title="Choose your home type"
      subtitle="Select whether you already have your land or need a footprint, then explore our architectural home layouts."
      onNext={next}
      onPrev={prev}
      nextDisabled={!canProceed}
      hidePrev
    >
      {/* Disclaimer — desktop only */}
      <div className="hidden sm:block max-w-2xl mx-auto mb-8 text-center text-[11px] sm:text-xs text-muted-foreground leading-relaxed p-4 rounded-xl border border-border/40 bg-white/[0.02]">
        &quot;Estimates provided are for informational purposes only. Please note that construction and market costs fluctuate; this estimate should be used for budgeting purposes only. We recommend using these as a starting point for your planning.&quot;
      </div>

      {/* Disclaimer — mobile only, compact */}
      <div className="sm:hidden max-w-full mx-auto mb-4 text-center text-[9px] text-muted-foreground leading-relaxed px-3 py-2 rounded-lg border border-border/30 bg-white/[0.015]">
        &quot;Estimates provided are for informational purposes only. Please note that construction and market costs fluctuate; this estimate should be used for budgeting purposes only. We recommend using these as a starting point for your planning.&quot;
      </div>

      {/* Property Status Segmented Toggle Control */}
      <div className="flex p-1 bg-soft-section border border-border/60 rounded-full max-w-[280px] mx-auto mb-4 sm:mb-10 shadow-sm">
        <button
          type="button"
          onClick={() => setLand('own')}
          className={`flex-1 rounded-full py-1.5 sm:py-2.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.15em] transition-all duration-300 ${
            land === 'own'
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          I Own Land
        </button>
        <button
          type="button"
          onClick={() => setLand('need')}
          className={`flex-1 rounded-full py-1.5 sm:py-2.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.15em] transition-all duration-300 ${
            land === 'need'
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          I Need Land
        </button>
      </div>

      {/* ── Home Type Cards — single responsive grid, no animation tricks ── */}
      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {TYPES.map(({ id, tag, desc, popular }) => {
          const d = HOME_TYPE_META[id];
          const active = homeType === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setHomeType(id)}
              className={`group relative w-full text-left rounded-2xl p-6 transition-all duration-300 border flex flex-col gap-4 ${
                active
                  ? 'bg-surface shadow-elev border-clay/30'
                  : 'bg-surface/60 border-border hover:bg-surface hover:border-muted-foreground/20 hover:shadow-soft'
              }`}
            >
              {active && <span className="absolute top-4 right-4 w-2 h-2 rounded-full bg-clay" />}

              <div>
                <div className={`text-[10px] uppercase tracking-[0.28em] font-bold mb-2 ${
                  popular
                    ? active ? 'text-clay' : 'text-clay/70'
                    : active ? 'text-muted-foreground/80' : 'text-muted-foreground/40'
                }`}>
                  {tag}
                </div>
                <h3 className="font-display text-2xl font-normal tracking-tight text-foreground leading-none mb-1">
                  {d.label}
                </h3>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 num mt-1">
                  {d.areaRange[0].toLocaleString()}–{d.areaRange[1].toLocaleString()} SQ FT · {d.bedrooms} BED
                </div>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed font-light">
                  {desc}
                </p>
              </div>

              <div className={`pt-4 border-t flex items-end justify-between ${active ? 'border-clay/20' : 'border-border/60'}`}>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50 mb-1 font-bold">Estimated</div>
                  <div className="font-display text-xl font-normal num tracking-tight text-foreground">{formatMoney(d.baseCost)}</div>
                </div>
                <HouseSilhouette type={id} active={active} />
              </div>
            </button>
          );
        })}
      </div>
    </StepShell>
  );
};
