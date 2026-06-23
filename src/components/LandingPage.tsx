import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { GBTILogoMark } from './GBTILogo';

interface LandingPageProps {
  onStart: () => void;
  onExplore?: () => void;
  onTurnkeyBuild?: () => void;
  onYoungProfessionalSubSelect?: (variant: 'flat' | 'two_storey') => void;
  onPrivatePurchase?: () => void;
}

const HouseBlueprintSVG = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[#B89B72]">
    <motion.path d="M2 21H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
    <motion.path d="M4 21V11H20V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.2 }} />
    <motion.path d="M2 11L12 3L22 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.6 }} />
    <motion.path d="M10 21V15H14V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.9 }} />
  </svg>
);

/* ── Individual card ───────────────────────────────────────── */
interface CardProps {
  num: string;
  title: string;
  subtitle: string;
  description: string;
  img: string;
  onClick?: () => void;
  disabled?: boolean;
  soon?: boolean;
  loading?: boolean;
}

const Card = ({ num, title, subtitle, description, img, onClick, disabled, soon, loading }: CardProps) => (
  <motion.button
    onClick={onClick}
    disabled={disabled || soon}
    whileHover={!disabled && !soon ? { scale: 1.02 } : {}}
    whileTap={!disabled && !soon ? { scale: 0.98 } : {}}
    className={`group relative flex flex-col justify-between text-left w-full
      h-[240px] sm:h-[500px] lg:h-[600px] xl:h-[680px]
      p-3 sm:p-5 lg:p-6
      rounded-2xl sm:rounded-3xl
      bg-zinc-800/40 backdrop-blur-md
      border transition-all duration-300 shadow-lg overflow-hidden
      ${soon
        ? 'border-[#B89B72]/40 opacity-70 cursor-not-allowed'
        : 'border-[#B89B72] hover:shadow-[0_0_30px_rgba(184,155,114,0.35)] hover:border-white/40'
      }`}
  >
    {/* Background image */}
    <div className="absolute inset-0 z-0">
      <img
        src={img}
        alt={title}
        className={`w-full h-full object-cover transition-opacity duration-500
          ${soon ? 'opacity-50 grayscale' : 'opacity-80 group-hover:opacity-100'}`}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/10 to-black/65" />
    </div>

    {/* Top content */}
    <div className="relative z-10">
      <div className={`font-bold text-sm sm:text-lg mb-1 sm:mb-3 ${soon ? 'text-[#B89B72]/50' : 'text-[#B89B72]'}`}>
        {num}
      </div>
      <h3 className={`text-[11px] sm:text-base lg:text-lg font-bold tracking-widest uppercase leading-tight mb-1 sm:mb-2
        ${soon ? 'text-zinc-400' : 'text-white'}`}>
        {title}<br />{subtitle}
      </h3>
      <p className="hidden sm:block text-[10px] sm:text-xs text-zinc-300 font-light leading-relaxed">
        {description}
      </p>
    </div>

    {/* Bottom row */}
    <div className="relative z-10 flex items-center justify-between w-full">
      {soon ? (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#B89B72]/40 animate-pulse" />
          <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-widest text-[#B89B72]/60">Soon</span>
        </div>
      ) : (
        <ArrowRight
          className="text-[#B89B72] group-hover:translate-x-1 transition-transform duration-300 ml-auto"
          size={16}
        />
      )}
    </div>

    {/* Loading overlay */}
    {loading && (
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center z-20 gap-3">
        <HouseBlueprintSVG />
        <span className="font-bold tracking-widest uppercase text-[#B89B72] animate-pulse text-xs text-center">
          Constructing...
        </span>
      </div>
    )}
  </motion.button>
);

/* ── Main Component ────────────────────────────────────────── */
export const LandingPage = ({ onStart, onExplore, onTurnkeyBuild, onYoungProfessionalSubSelect, onPrivatePurchase }: LandingPageProps) => {
  const [isBuilding, setIsBuilding] = useState(false);
  const [showYPOptions, setShowYPOptions] = useState(false);
  const isMobile = useIsMobile();

  const handleStart = () => {
    if (isBuilding) return;
    setIsBuilding(true);
    const delay = isMobile ? 250 : 1600;
    setTimeout(() => onStart(), delay);
  };

  return (
    <div
      className="fixed inset-0 z-50 w-full overflow-x-hidden overflow-y-auto font-sans select-none"
      style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      {/* ── Background ─────────────────────────────────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <motion.img
          initial={{ scale: 1.06, opacity: 0 }}
          animate={{ scale: isBuilding ? 1.02 : 1.06, opacity: 1 }}
          transition={{
            scale: { duration: isBuilding ? 1.6 : 30, ease: 'easeOut' },
            opacity: { duration: 1.2 },
          }}
          src="/hero-render.png"
          alt="Luxury Home"
          className="w-full h-full object-cover blur-[8px] brightness-90 object-center"
        />
        <div className="absolute inset-0 bg-black/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        {/* ambient glows */}
        <div className="absolute top-[20%] right-[20%] w-[300px] h-[300px] bg-amber-500/[0.04] rounded-full blur-[100px]" />
        <div className="absolute bottom-[20%] left-[10%] w-[350px] h-[350px] bg-cyan-500/[0.03] rounded-full blur-[120px]" />
      </div>

      {/* Blueprint scanner */}
      <AnimatePresence>
        {isBuilding && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 0.12 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-10 bg-[linear-gradient(to_right,rgba(184,155,114,0.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(184,155,114,0.15)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isBuilding && (
          <motion.div
            initial={{ top: '-5%' }} animate={{ top: '105%' }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
            className="fixed left-0 right-0 h-1.5 bg-[#B89B72]/80 shadow-[0_0_20px_#B89B72,0_0_40px_#B89B72] z-20 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* ── Scrollable content ─────────────────────────────── */}
      <div className="relative z-20 min-h-[100dvh] w-full flex flex-col">

        {/* ── Top bar ──────────────────────────────────────── */}
        <div className="flex items-start justify-between px-3 pt-3 sm:px-6 sm:pt-6 lg:px-10 lg:pt-8">
          {/* Title (left) */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex flex-col"
          >
            <h1 className="text-xl sm:text-3xl lg:text-4xl font-display font-light tracking-tight text-white leading-[1.1]">
              Design Your Home
            </h1>
            <p className="text-[8px] sm:text-[10px] text-[#B89B72] font-semibold tracking-[0.2em] uppercase mt-1">
              Select an architectural pathway
            </p>
          </motion.div>

          {/* GBTI logo (right) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="flex flex-col items-center gap-1 flex-shrink-0 ml-3"
          >
            <div className="bg-black/45 backdrop-blur-md px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-xl sm:rounded-2xl border border-white/5 shadow-xl">
              <GBTILogoMark size={isMobile ? 32 : 48} />
            </div>
            <span className="text-[7px] sm:text-[9px] font-bold tracking-[0.18em] uppercase text-white/80 leading-none">
              Smart Home Builder
            </span>
          </motion.div>
        </div>

        {/* ── Cards grid ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 px-3 pt-3 pb-6 sm:px-6 sm:pt-4 sm:pb-8 lg:px-10 lg:pt-6 lg:pb-10"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 lg:gap-6 w-full">

            {/* 1. Turn Key Build */}
            <Card
              num="01."
              title="Turn Key"
              subtitle="Build"
              description="Experience an effortless path to homeownership and visualize this professionally designed, built, and ready for you to move in home."
              img="/turnkey.png"
              onClick={onTurnkeyBuild}
            />

            {/* 2. Young Professional */}
            <Card
              num="02."
              title="Young"
              subtitle="Professional"
              description="Walk through this modern, and stylish living space —the perfect foundation for your career, lifestyle and future growth."
              img="/young_professional.png"
              onClick={() => setShowYPOptions(true)}
            />

            {/* 3. Private Purchase */}
            <Card
              num="03."
              title="Private"
              subtitle="Purchase"
              description="Total freedom to own your dream property with a seamless, transparent buying experience for your own private property, backed by trusted GBTI expert guidance."
              img="/private_purchase.png"
              onClick={onPrivatePurchase}
            />

            {/* 4. Build Your Own */}
            <Card
              num="04."
              title="Build"
              subtitle="Your Own"
              description="Fully customize layouts, explore real-time floor plans, and configure smart home features."
              img="/build_your_own.png"
              onClick={handleStart}
              disabled={isBuilding}
              loading={isBuilding}
            />

          </div>

          {/* Explore link */}
          {onExplore && (
            <div className="pt-3 sm:pt-4 flex justify-center border-t border-[#B89B72]/10 mt-2">
              <button
                onClick={onExplore}
                className="text-[8px] sm:text-[9px] font-bold tracking-[0.25em] uppercase text-zinc-400 hover:text-white transition-colors duration-300 py-2"
              >
                Direct Architectural Overview
              </button>
            </div>
          )}
        </motion.div>

        {/* ── Bottom footer — Beharry-Amber branding ──────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.9 }}
          className="pb-4 pt-2 flex flex-col items-center gap-1.5 border-t border-white/[0.06] mx-4 sm:mx-6"
        >
          <span className="text-white/35 uppercase font-semibold tracking-[0.25em]" style={{ fontSize: '7px' }}>Powered By</span>
          <img src="/beharry-amber-logo-mark.png" alt="Beharry-Amber" className="h-4 sm:h-5 object-contain opacity-60" />
          <span className="text-white/55 font-semibold tracking-wide" style={{ fontSize: '8.5px' }}>Beharry-Amber Technologies Inc.</span>
          <span className="text-white/30 font-medium" style={{ fontSize: '7px', letterSpacing: '0.06em' }}>AI Engineered Solutions</span>
        </motion.div>

      </div>

      {/* ── Young Professional Sub-Selection Overlay ──────────── */}
      <AnimatePresence>
        {showYPOptions && (
          <motion.div
            key="yp-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[80] flex items-center justify-center"
            style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', backgroundColor: 'rgba(0,0,0,0.72)' }}
            onClick={() => setShowYPOptions(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 24 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md mx-4 rounded-3xl overflow-hidden"
              style={{ background: 'linear-gradient(145deg, rgba(30,24,18,0.98) 0%, rgba(15,12,8,0.98) 100%)', border: '1px solid rgba(184,155,114,0.25)', boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(184,155,114,0.08)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setShowYPOptions(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all duration-200 z-10"
              >
                <X size={15} />
              </button>

              {/* Header */}
              <div className="px-7 pt-8 pb-5">
                <div className="text-[#B89B72] text-[10px] font-bold uppercase tracking-[0.25em] mb-2">02. Young Professional</div>
                <h2 className="text-white text-xl font-bold tracking-tight leading-snug">Select Your Home Style</h2>
                <p className="text-white/40 text-xs mt-1.5 leading-relaxed">Choose the layout that fits your lifestyle and vision.</p>
              </div>

              {/* Divider */}
              <div className="mx-7 h-px bg-gradient-to-r from-transparent via-[#B89B72]/20 to-transparent" />

              {/* Options */}
              <div className="px-7 py-6 space-y-3">

                {/* Option 1: Flat */}
                <motion.button
                  whileHover={{ scale: 1.02, x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setShowYPOptions(false); onYoungProfessionalSubSelect?.('flat'); }}
                  className="group w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl text-left transition-all duration-300"
                  style={{ background: 'rgba(184,155,114,0.07)', border: '1px solid rgba(184,155,114,0.18)' }}
                >
                  <div>
                    <div className="text-white text-sm font-bold tracking-wide mb-0.5">Young Professional – Flat</div>
                    <div className="text-white/40 text-[11px] leading-relaxed">Single-level modern living space</div>
                  </div>
                  <ArrowRight size={16} className="text-[#B89B72] flex-shrink-0 transition-transform group-hover:translate-x-1" />
                </motion.button>

                {/* Option 2: 2 Storey */}
                <motion.button
                  whileHover={{ scale: 1.02, x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setShowYPOptions(false); onYoungProfessionalSubSelect?.('two_storey'); }}
                  className="group w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl text-left transition-all duration-300"
                  style={{ background: 'rgba(184,155,114,0.07)', border: '1px solid rgba(184,155,114,0.18)' }}
                >
                  <div>
                    <div className="text-white text-sm font-bold tracking-wide mb-0.5">Young Professional – 2 Storey</div>
                    <div className="text-white/40 text-[11px] leading-relaxed">Two-level home for expanded living</div>
                  </div>
                  <ArrowRight size={16} className="text-[#B89B72] flex-shrink-0 transition-transform group-hover:translate-x-1" />
                </motion.button>
              </div>

              {/* Footer note */}
              <div className="px-7 pb-6">
                <p className="text-white/20 text-[10px] text-center uppercase tracking-[0.18em]">GBTI Smart Home Builder</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
