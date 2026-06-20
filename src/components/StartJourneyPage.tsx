import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { GBTILogoMark } from './GBTILogo';

interface StartJourneyPageProps {
  onProceed: () => void;
}

/* ── Floating dot particle ─────────────────────────────────── */
const FloatingDot = ({ delay, x, y, size }: { delay: number; x: number; y: number; size: number }) => (
  <motion.div
    className="absolute rounded-full pointer-events-none"
    style={{
      width: size,
      height: size,
      left: `${x}%`,
      top: `${y}%`,
      background: `radial-gradient(circle, rgba(0,161,179,0.35) 0%, rgba(0,87,164,0.12) 60%, transparent 100%)`,
    }}
    initial={{ opacity: 0, scale: 0 }}
    animate={{
      opacity: [0, 0.6, 0.3, 0.6, 0],
      scale: [0.4, 1, 0.8, 1, 0.4],
      y: [0, -20, -10, -25, 0],
    }}
    transition={{
      duration: 8,
      delay,
      repeat: Infinity,
      ease: 'easeInOut',
    }}
  />
);

/* ── Main Component ────────────────────────────────────────── */
export const StartJourneyPage = ({ onProceed }: StartJourneyPageProps) => {
  const [isExiting, setIsExiting] = useState(false);
  const [logoReady, setLogoReady] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    // ← Update this URL when a new build is deployed
    const url = 'https://dev-gbti-web.pocweburl.com/';
    setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=111111&format=svg`);
    const t = setTimeout(() => setLogoReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  const handleProceed = () => {
    setIsExiting(true);
    setTimeout(() => onProceed(), 900);
  };

  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 3 + Math.random() * 4,
        delay: Math.random() * 6,
      })),
    [],
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#060608] overflow-hidden select-none">

      {/* ── Background ─────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#00A1B3]/[0.04] blur-[140px]" />
        <div className="absolute top-[30%] left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-[#0057A4]/[0.05] blur-[120px]" />
      </div>

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.2) 1px, transparent 0)`,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Floating particles */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((p) => (
          <FloatingDot key={p.id} delay={p.delay} x={p.x} y={p.y} size={p.size} />
        ))}
      </div>

      {/* Corner watermark logos */}
      <div className="absolute top-5 left-5 opacity-[0.06] pointer-events-none">
        <GBTILogoMark size={24} />
      </div>
      <div className="absolute top-5 right-5 opacity-[0.06] pointer-events-none rotate-180">
        <GBTILogoMark size={24} />
      </div>

      {/* ── Scrollable Content ──────────────────────────────── */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-5 py-16 sm:py-12">

          <AnimatePresence>
            {!isExiting && (
              <motion.div
                key="journey-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 1.06, filter: 'blur(16px)' }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-sm flex flex-col items-center text-center"
              >
                {/* GBTI Logo */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.6, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="relative mb-6"
                >
                  <motion.div
                    className="absolute -inset-6 rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(0,161,179,0.12) 0%, transparent 70%)' }}
                    animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <GBTILogoMark size={120} animate={logoReady} />
                </motion.div>

                {/* Separator */}
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="w-10 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mb-7 origin-center"
                />

                {/* Headline */}
                <motion.h1
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.75 }}
                  className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-tight leading-[1.1] mb-3"
                >
                  Start Your Journey
                </motion.h1>

                {/* Sub-headline */}
                <motion.p
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.9 }}
                  className="text-white/30 text-xs sm:text-sm leading-relaxed mb-8 max-w-[280px] sm:max-w-xs"
                >
                  Design, visualize, and build your dream home with GBTI's immersive 3D configurator.
                  <br className="hidden sm:block" />
                  {' '}Scan to open on mobile, or proceed below.
                </motion.p>

                {/* QR Code */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={isExiting
                    ? { scale: [1, 0.85, 8], opacity: [1, 1, 0] }
                    : { opacity: 1, scale: 1 }
                  }
                  transition={isExiting
                    ? { duration: 0.6, times: [0, 0.3, 1], ease: 'easeInOut' }
                    : { delay: 1.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }
                  }
                  className={`mb-8 ${isExiting ? 'pointer-events-none relative z-50' : ''}`}
                  style={{ willChange: 'transform, opacity' }}
                >
                  <div className="relative p-4 sm:p-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm overflow-hidden">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#00A1B3]/10 to-transparent blur-xl opacity-60" />
                    {/* Corner accents */}
                    <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#00A1B3]/40 rounded-tl-md" />
                    <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#00A1B3]/40 rounded-tr-md" />
                    <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#00A1B3]/40 rounded-bl-md" />
                    <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#00A1B3]/40 rounded-br-md" />
                    <div className="relative bg-white rounded-xl p-3">
                      {qrUrl ? (
                        <img
                          src={qrUrl}
                          alt="Scan to continue on mobile"
                          className="w-[140px] h-[140px] sm:w-[170px] sm:h-[170px]"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      ) : (
                        <div className="w-[140px] h-[140px] sm:w-[170px] sm:h-[170px] flex items-center justify-center">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, ease: 'linear', duration: 1 }}
                            className="w-6 h-6 border-2 border-gray-200 border-t-gray-500 rounded-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>

                {/* CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 1.2 }}
                  className="flex flex-col items-center gap-3 w-full"
                >
                  <button
                    id="journey-continue"
                    onClick={handleProceed}
                    disabled={isExiting}
                    className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 px-10 py-3.5 rounded-2xl overflow-hidden text-white text-xs sm:text-sm font-semibold transition-all duration-500 hover:scale-[1.03] hover:shadow-2xl active:scale-[0.97] disabled:opacity-60 border border-white/[0.08]"
                    style={{
                      background: 'linear-gradient(135deg, #0057A4 0%, #00A1B3 100%)',
                      boxShadow: '0 8px 32px rgba(0, 161, 179, 0.18), 0 2px 8px rgba(0, 87, 164, 0.12)',
                    }}
                  >
                    <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-100%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(100%)]">
                      <div className="relative h-full w-10 bg-white/15" />
                    </div>
                    <span className="relative tracking-[0.15em] uppercase">Continue Here</span>
                    <ArrowRight size={15} className="relative transition-transform duration-500 group-hover:translate-x-1" />
                  </button>
                </motion.div>

                {/* Decorative dots */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 1.4 }}
                  className="flex items-center gap-1.5 mt-10"
                >
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1 h-1 rounded-full bg-white/15"
                      animate={{ opacity: [0.2, 0.6, 0.2] }}
                      transition={{ duration: 2, delay: i * 0.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  ))}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* ── Footer — Powered By (bottom, subtle) ─────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isExiting ? 0 : 1 }}
        transition={{ duration: 0.8, delay: 1.6 }}
        className="relative z-10 flex-shrink-0 pb-6 pt-4 flex flex-col items-center gap-2 border-t border-white/[0.08]"
      >
        <span className="font-semibold uppercase text-white/50 tracking-[0.25em]" style={{ fontSize: '8px' }}>
          Powered By
        </span>
        <img
          src="/beharry-amber-logo-mark.png"
          alt="Beharry-Amber Technologies"
          className="h-5 object-contain opacity-70"
        />
        <span className="text-white/60 font-semibold tracking-wide" style={{ fontSize: '9px' }}>
          Beharry-Amber Technologies Inc.
        </span>
        <span className="text-white/35 font-medium" style={{ fontSize: '7px', letterSpacing: '0.08em' }}>
          AI Engineered Solutions
        </span>
      </motion.div>

    </div>
  );
};
