import { useState, useEffect, useRef, useCallback } from 'react';
import { z } from 'zod';
import { getBuiltInPresetKey, getElevationLookupKeys, useConfig } from '@/store/configurator';
import type { ConfigActions, ConfigState } from '@/store/configurator';
import { StepShell } from '../StepShell';
import { CostBreakdown, formatMoney } from '@/lib/cost';
import { fetchElevationImagesByVariant, resolveElevationVariant } from '@/lib/elevationVariants';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ArrowRight, Mail, Pencil, X, Send, Loader2 } from 'lucide-react';
import { useQuotationEngine } from '@/hooks/useQuotationEngine';
import { QuoteSummary } from '@/components/financing/QuoteSummary';
import { formatMoneyDynamic } from '@/hooks/useDynamicPricing';
import { generateEstimatePDF } from '@/lib/generateEstimatePDF';
import { FloorPlanCanvas, FloorPlanCanvasHandle } from '../FloorPlanCanvas';
import { Plan } from '@/lib/floorplan';

type ConfigStore = ConfigState & ConfigActions;

const TIMELINES = ['0–3 months', '3–6 months', '6–12 months', '12+ months'];
const INFOBIP_API_KEY = import.meta.env.VITE_INFOBIP_API_KEY;
const INFOBIP_BASE_URL = import.meta.env.VITE_INFOBIP_BASE_URL;
const INFOBIP_SENDER_EMAIL = import.meta.env.VITE_INFOBIP_SENDER_EMAIL;
const INFOBIP_SENDER_NAME = import.meta.env.VITE_INFOBIP_SENDER_NAME || 'GBTI Loans Team';

// Tracked loan application link — Supabase increments click count per leadId
const LOAN_APPLICATION_URL = 'https://gbtibank.com/apply-for-a-loan/';

// GBTI logo hosted on Supabase Storage — publicly accessible, works in all email clients including Gmail
const GBTI_LOGO_URL = 'https://ekvzvjxwvjlgquvxfkqy.supabase.co/storage/v1/object/public/elevation-images/email-assets/gbti-logo.png';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  phone: z.string().trim().min(6, 'Enter a valid phone').max(30),
  email: z.string().trim().email('Enter a valid email').max(255),
  timeline: z.string().optional(),
});

const emailSchema = z.string().trim().email('Enter a valid email address');

interface Props {
  cost: CostBreakdown;
  plan: Plan;
  onReset?: () => void;
}

const generateLeadId = () => {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

// ── Email HTML builder (new GBTI verbatim) ─────────────────────────────────

const buildGBTIEmailHtml = ({
  name,
  leadId,
  cost,
  loanAmount,
  downPayment,
  monthlyEMI,
}: {
  name: string;
  leadId: string;
  cost: CostBreakdown;
  loanAmount: number;
  downPayment: number;
  monthlyEMI: number;
}) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">

    <!-- Header with Logo -->
    <div style="padding:24px 32px 16px;text-align:center;">
      <img src="${GBTI_LOGO_URL}" alt="GBTI - We see Guyana through your eyes" style="max-width:110px;height:auto;display:block;margin:0 auto;" />
    </div>

    <!-- Body -->
    <div style="padding:0 32px 36px;">
      <h1 style="font-size:18px;font-weight:700;color:#003b6d;margin:0 0 4px;">Your Home Estimate is Ready</h1>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Reference ID: <strong style="color:#111827;">${leadId.slice(0,8).toUpperCase()}</strong></p>

      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">Dear ${name},</p>
      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">Thank you for starting your home dream journey with GBTI.</p>
      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">We have attached your personalized dream home and cost estimate PDF for your records. We hope this helps you get a clearer picture of your path forward.</p>
      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">You can take the next step toward your goals by starting your formal application here:</p>

      <!-- CTA Button -->
      <div style="margin:0 0 32px;text-align:center;">
        <a href="${LOAN_APPLICATION_URL}?ref=${leadId}" target="_blank"
           style="display:inline-block;background:#0d65a6;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:4px;">
          Start Your Loan Application
        </a>
      </div>

      <!-- Summary -->
      <div style="margin:0 0 24px;">
        <div style="font-size:16px;font-weight:700;color:#00a8ad;margin-bottom:12px;">Estimated Summary</div>
        <table style="width:100%;border-collapse:collapse;">
          ${[
            ['Est. Property Price', formatMoney(cost.total)],
            ['Loan Amount', formatMoney(loanAmount)],
            ['Down Payment', formatMoney(downPayment)],
            ['Monthly Repayment', formatMoney(monthlyEMI)],
          ].map(([label, value]) => `
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#374151;">${label}</td>
            <td style="padding:6px 0;font-size:13px;color:#374151;text-align:right;">${value}</td>
          </tr>`).join('')}
        </table>
        <p style="font-size:11px;color:#888;font-style:italic;margin:16px 0 0;line-height:1.4;">
          * Solar Panels, Water Tank, and Generator are included in the total estimate but not in the loan amount due to ineligibility for bank financing.
        </p>
      </div>

      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 8px;">Our dedicated team is here to support you at every stage. If you have any questions or need guidance, please don't hesitate to reach out on</p>
      <p style="font-size:14px;font-weight:700;color:#003b6d;margin:0 0 24px;">+592 231 4400</p>
      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">We look forward to helping you build your future.</p>
      <p style="font-size:14px;color:#374151;margin:0 0 8px;">Best regards,<br><strong style="color:#003b6d;">GBTI Loans Team</strong></p>
    </div>

    <!-- Footer -->
    <div style="background:#00a8ad;padding:20px 32px;text-align:center;margin-top:8px;">
      <p style="font-size:13px;color:#ffffff;margin:0 0 4px;font-weight:600;white-space:nowrap;">GBTI Bank &middot; +592 231 4400</p>
      <p style="font-size:12px;color:rgba(255,255,255,0.85);margin:0;white-space:nowrap;">Estimates are indicative. Final pricing confirmed by your architect.</p>
    </div>
  </div>
</body>
</html>
`;

// ── Send email via Infobip with PDF attachment ──────────────────────────────

const sendGBTIEmail = async ({
  name,
  email,
  leadId,
  cost,
  loanAmount,
  downPayment,
  monthlyEMI,
  pdfBlob,
}: {
  name: string;
  email: string;
  leadId: string;
  cost: CostBreakdown;
  loanAmount: number;
  downPayment: number;
  monthlyEMI: number;
  pdfBlob?: Blob;
}) => {
  if (!INFOBIP_API_KEY || !INFOBIP_BASE_URL || !INFOBIP_SENDER_EMAIL) {
    throw new Error('Infobip env is not configured');
  }

  const htmlContent = buildGBTIEmailHtml({ name, leadId, cost, loanAmount, downPayment, monthlyEMI });

  const form = new FormData();
  form.append('from', `${INFOBIP_SENDER_NAME} <${INFOBIP_SENDER_EMAIL}>`);
  form.append('to', `${name} <${email}>`);
  form.append('subject', `${name} - Your GBTI Home Estimate is ready`);
  form.append('html', htmlContent);
  form.append('text', [
    `Dear ${name},`,
    '',
    'Thank you for starting your home dream journey with GBTI.',
    '',
    'We have attached your personalized dream home and cost estimate PDF for your records.',
    'We hope this helps you get a clearer picture of your path forward.',
    '',
    'You can take the next step toward your goals by starting your formal application here:',
    `Start Your Loan Application: ${LOAN_APPLICATION_URL}?ref=${leadId}`,
    '',
    `Our dedicated team is here to support you at every stage. If you have any questions`,
    `or need guidance, please don't hesitate to reach out on +592 231 4400`,
    '',
    'We look forward to helping you build your future.',
    '',
    'Best regards,',
    'GBTI Loans Team',
  ].join('\n'));

  if (pdfBlob) {
    form.append('attachment', pdfBlob, `GBTI_Estimate_${leadId.slice(0, 8).toUpperCase()}.pdf`);
  }

  const response = await fetch(`${INFOBIP_BASE_URL}/email/3/send`, {
    method: 'POST',
    headers: { Authorization: `App ${INFOBIP_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Infobip request failed');
  }
};

// ── Send to Inbox Modal ─────────────────────────────────────────────────────

interface InboxModalProps {
  originalEmail: string;
  name: string;
  onConfirm: (finalEmail: string, emailChanged: boolean) => Promise<void>;
  onClose: () => void;
  sending: boolean;
}

const SendToInboxModal = ({ originalEmail, name, onConfirm, onClose, sending }: InboxModalProps) => {
  const [email, setEmail] = useState(originalEmail);
  const [emailError, setEmailError] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== originalEmail.trim().toLowerCase();

  const handleConfirm = async () => {
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setEmailError(result.error.errors[0].message);
      return;
    }
    setEmailError('');
    await onConfirm(email.trim(), emailChanged);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 12 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="bg-[#111827] px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-base">Send to My Inbox</div>
            <div className="text-[#b8956a] text-[10px] uppercase tracking-widest mt-0.5">GBTI Home Estimate PDF</div>
          </div>
          {!sending && (
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-5">
          <p className="text-sm text-gray-600 leading-relaxed">
            We'll send your personalised home estimate PDF to the email below.
            You can update it if needed before sending.
          </p>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 block mb-2">
              Delivery Email
            </label>
            <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 transition-all ${isEditing ? 'border-[#b8956a] ring-2 ring-[#b8956a]/20' : 'border-gray-200 bg-gray-50'}`}>
              <Mail size={15} className="text-gray-400 flex-shrink-0" />
              {isEditing ? (
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                  className="flex-1 bg-transparent text-sm text-gray-900 outline-none"
                  autoFocus
                  onBlur={() => setIsEditing(false)}
                />
              ) : (
                <span className="flex-1 text-sm text-gray-900">{email}</span>
              )}
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-[#b8956a] hover:text-[#a07850] transition-colors flex items-center gap-1 text-[11px] font-semibold"
                >
                  <Pencil size={11} /> Change
                </button>
              )}
            </div>
            {emailError && <p className="mt-1.5 text-xs text-red-500">{emailError}</p>}
            {emailChanged && !emailError && (
              <p className="mt-1.5 text-[10px] text-amber-600 font-medium">
                ✱ Different from your initial entry — we'll note this change.
              </p>
            )}
          </div>

          {/* What they'll receive */}
          <div className="bg-[#faf8f5] rounded-xl p-4 border border-[#e5e7eb] space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#b8956a]">What you'll receive</div>
            {[
              'Personalised PDF estimate with floor plan & elevation',
              'Full cost breakdown & financing summary',
              'Direct link to start your formal loan application',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-xs text-gray-600">
                <span className="text-[#b8956a] mt-0.5">✓</span> {item}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          {!sending && (
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={sending}
            className="flex-1 py-3 rounded-xl bg-[#111827] text-white text-sm font-semibold hover:bg-[#1f2937] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {sending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send size={14} />
                Send to My Inbox
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────

export const StepLeadCapture = ({ cost, plan, onReset }: Props) => {
  const c = useConfig();
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [sending, setSending] = useState(false);
  const leadIdRef = useRef<string | null>(null);
  const floorPlanRef = useRef<FloorPlanCanvasHandle>(null);
  const propertyPrice = c.propertyPrice;
  const setPropertyPrice = c.setPropertyPrice;

  // Turnkey Build and Young Professional users who click "Continue" in the external viewer
  // are sent to this same step (Step 3) — they also need to input a property price.
  const isPrivatePurchase = c.homeType === 'private_purchase' || c.homeType === 'turnkey' || c.homeType === 'young_professional';
  const effectiveTotal = isPrivatePurchase ? propertyPrice : cost.total;
  const effectiveLandCost = isPrivatePurchase ? 0 : cost.landCost;
  const effectiveLoanableAmount = isPrivatePurchase ? propertyPrice : (cost.total - (cost.nonLoanAddonsCost ?? 0));

  const { mortgageEngine, finalQuote } = useQuotationEngine(
    effectiveTotal,
    effectiveLandCost,
    effectiveLoanableAmount
  );

  // ── Auto-reset countdown ──────────────────────────────────────────────
  const COUNTDOWN_SECONDS = 10;
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFullReset = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (onReset) onReset();
    else useConfig.getState().reset();
  }, [onReset]);

  useEffect(() => {
    if (!done) return;
    setCountdown(COUNTDOWN_SECONDS);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          handleFullReset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [done, handleFullReset]);

  // ── Save lead to Supabase (first step — before email modal) ──────────
  const handleRequestSend = async () => {
    const parsed = schema.safeParse({ name: c.name, phone: c.phone, email: c.email, timeline: c.timeline });
    if (!parsed.success) {
      toast.error('Missing contact details. Please start over.');
      return;
    }
    setErrors({});
    setSubmitting(true);

    const timelineVal = c.timeline || 'Not specified';
    const presetKey = getBuiltInPresetKey(c, c.presetId);
    const elevationKeyOrder = getElevationLookupKeys(c, c.presetId);
    const elevationVariant = await resolveElevationVariant(c, c.presetId);
    const elevationRows = await fetchElevationImagesByVariant(elevationVariant.id, elevationKeyOrder);
    const serializedElevationRows = elevationRows.map((row) => ({
      id: row.id,
      image_url: row.image_url,
      image_path: row.image_path,
      variant_id: row.variant_id ?? null,
      preset_key: row.preset_key ?? null,
    }));

    const config = {
      land: c.land,
      land_size: c.landSize,
      custom_land_area: c.customLandArea,
      home_type: c.homeType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      kitchen: c.kitchen,
      finishing_quality: c.finishingQuality,
      addons: c.addons,
      roof: c.roof,
      material: c.material,
      area: cost.area,
      preset_id: c.presetId,
      loaded_preset_id: c.loadedPresetId,
      is_double_storey: c.isDoubleStorey,
      active_floor: c.activeFloor,
      advanced_editor_mode: c.advancedEditorMode,
      preset_key: presetKey,
      selected_plan: c.customPlan,
      first_floor_plan: c.customFirstFloorPlan,
      elevation_images: serializedElevationRows,
      estimate: {
        total: cost.total,
        down_payment: cost.downPayment,
        loan_amount: cost.loanAmount,
        monthly_emi: cost.emi,
        base_structure: cost.baseStructure,
        bedroom_cost: cost.bedroomCost,
        bathroom_cost: cost.bathroomCost,
        kitchen_cost: cost.kitchenCost,
        addons_cost: cost.addonsCost,
        land_cost: cost.landCost,
        items: cost.items,
      },
    };

    const leadId = generateLeadId();
    leadIdRef.current = leadId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('submit_lead', {
      p_id:         leadId,
      p_name:       c.name.trim(),
      p_phone:      c.phone.trim(),
      p_email:      c.email.trim(),
      p_timeline:   timelineVal,
      p_config:     config,
      p_total_cost: cost.total,
    });

    setSubmitting(false);

    if (error) {
      toast.error('Submission failed — please try again');
      return;
    }

    // Open modal to confirm/change email
    setShowInboxModal(true);
  };

  // ── Handle final email send (from modal) ─────────────────────────────
  const handleSendToInbox = async (finalEmail: string, emailChanged: boolean) => {
    setSending(true);
    const leadId = leadIdRef.current!;
    const timelineVal = c.timeline || 'Not specified';

    try {
      // Track email address changes
      if (emailChanged) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.rpc as any)('update_lead_config', {
          p_id:     leadId,
          p_config: { email_changed: true, original_email: c.email.trim(), delivery_email: finalEmail },
        });
      }

      // Generate PDF
      const elevationVariant = await resolveElevationVariant(c, c.presetId);
      const elevationRows = await fetchElevationImagesByVariant(
        elevationVariant.id,
        getElevationLookupKeys(c, c.presetId)
      );
      const elevationImageUrl = elevationRows?.[0]?.image_url || undefined;

      // Capture floor plan snapshot from hidden canvas
      let floorPlanDataUrl: string | undefined;
      try {
        const stage = floorPlanRef.current?.getStage();
        if (stage) {
          floorPlanDataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });
        }
      } catch (snapErr) {
        console.warn('Floor plan snapshot failed:', snapErr);
      }

      let pdfBlob: Blob | undefined;
      try {
        pdfBlob = await generateEstimatePDF({
          cost,
          c,
          loanAmount: finalQuote.loanAmount,
          downPayment: finalQuote.downPayment,
          monthlyEMI: finalQuote.monthlyEMI,
          interestRate: finalQuote.interestRate,
          tenureYears: finalQuote.tenureYears,
          elevationImageUrl,
          floorPlanDataUrl,
          leadId,
        });
      } catch (pdfErr) {
        console.error('PDF generation failed, sending without attachment:', pdfErr);
      }

      // Send email
      if (INFOBIP_API_KEY && INFOBIP_BASE_URL && INFOBIP_SENDER_EMAIL) {
        await sendGBTIEmail({
          name: c.name.trim(),
          email: finalEmail,
          leadId,
          cost,
          loanAmount: finalQuote.loanAmount,
          downPayment: finalQuote.downPayment,
          monthlyEMI: finalQuote.monthlyEMI,
          pdfBlob,
        });
      } else {
        // Fallback: Supabase edge function
        await supabase.functions.invoke('send-proposal-email', {
          body: {
            leadId,
            name: c.name.trim(),
            email: finalEmail,
            phone: c.phone.trim(),
            timeline: timelineVal,
            estimate: {
              total: cost.total,
              area: cost.area,
              downPayment: finalQuote.downPayment,
              loanAmount: finalQuote.loanAmount,
              emi: finalQuote.monthlyEMI,
              items: cost.items,
            },
          },
        });
      }

      setShowInboxModal(false);
      setDone(true);
    } catch {
      toast.error('Estimate saved, but email delivery failed. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <StepShell
        eyebrow="Step 05 · Finalization"
        title="Request your proposal."
        subtitle="Review your financing options and connect with our design team."
        onPrev={() => useConfig.getState().prev()}
      >
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="py-6 sm:py-12 text-center"
              >
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="inline-flex items-center justify-center h-16 w-16 sm:h-24 sm:w-24 rounded-full bg-soft-section border border-clay/20 text-clay mb-10"
                >
                  <CheckCircle2 size={40} strokeWidth={1} />
                </motion.div>

                <h3 className="font-display text-2xl sm:text-3xl md:text-5xl font-normal tracking-tight text-foreground mb-4">
                  On its way!
                </h3>

                <p className="text-muted-foreground max-w-md mx-auto text-base sm:text-lg leading-relaxed font-light mb-2">
                  Your estimate PDF has been sent to your inbox, <span className="text-foreground font-medium">{c.name.split(' ')[0]}</span>.
                </p>
                <p className="text-muted-foreground/60 text-sm">
                  Check your email and click <span className="text-foreground font-medium">"Start Your Loan Application"</span> when you're ready to proceed.
                </p>

                <button
                  onClick={handleFullReset}
                  className="mt-12 inline-flex items-center gap-3 rounded-full bg-foreground text-background px-6 py-3 sm:px-10 sm:py-4 text-[10px] font-bold uppercase tracking-[0.3em] transition-all hover:scale-105 active:scale-95"
                >
                  New Configuration <ArrowRight size={14} />
                </button>

                {/* Auto-reset countdown */}
                <div className="mt-8 max-w-xs mx-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">Returning to start</span>
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 num">{countdown}s</span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-border/60 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-clay"
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: COUNTDOWN_SECONDS, ease: 'linear' }}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="max-w-2xl mx-auto"
              >
                {isPrivatePurchase && (
                  <div className="mb-8 p-6 rounded-2xl border border-border/40 bg-white/[0.02]">
                    <label className="block text-sm font-semibold text-foreground mb-3">
                      Property Price
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">$</span>
                      <input
                        type="number"
                        value={propertyPrice || ''}
                        onChange={(e) => setPropertyPrice(Number(e.target.value) || 0)}
                        placeholder="Enter property price"
                        className="w-full pl-10 pr-4 py-4 rounded-xl border border-border/60 bg-surface text-foreground text-lg focus:outline-none focus:ring-2 focus:ring-clay/50 transition-all"
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Enter the total price of the property you wish to purchase
                    </p>
                  </div>
                )}
                <QuoteSummary quote={finalQuote} mortgageEngine={mortgageEngine} />

                <div className="mt-8 flex justify-center">
                  <button
                    onClick={handleRequestSend}
                    disabled={submitting}
                    className="w-full py-4 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white font-semibold transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 text-[15px]"
                  >
                    {submitting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <>
                        <Mail size={18} />
                        Send to My Inbox — {formatMoneyDynamic(finalQuote.totalPropertyPrice)}
                      </>
                    )}
                  </button>
                </div>

                <div className="mt-6 text-center text-[10px] sm:text-xs text-muted-foreground leading-relaxed p-4 rounded-xl border border-border/40 bg-white/[0.02]">
                  &quot;Mortgage rates and total costs are subject to change based on lender requirements, credit profile, and real-time market data. Always consult with a qualified financial advisor before making final commitments.&quot;
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </StepShell>

      {/* Hidden canvas for PDF snapshot generation */}
      <div style={{ position: 'absolute', top: -9999, left: -9999, width: 800, height: 600, opacity: 0, pointerEvents: 'none' }}>
        <FloorPlanCanvas ref={floorPlanRef} plan={plan} advanced={false} minimal={true} hideZoomHelper={true} />
      </div>

      {/* Send to Inbox Modal */}
      <AnimatePresence>
        {showInboxModal && (
          <SendToInboxModal
            originalEmail={c.email.trim()}
            name={c.name.trim()}
            onConfirm={handleSendToInbox}
            onClose={() => !sending && setShowInboxModal(false)}
            sending={sending}
          />
        )}
      </AnimatePresence>
    </>
  );
};
