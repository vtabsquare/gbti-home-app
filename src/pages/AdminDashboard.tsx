import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatMoney } from '@/lib/cost';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, Mail, Download, Settings, Layout, ChevronLeft, ChevronRight,
  Search, Trash2, CheckSquare, Square, Send, X, DollarSign, Home, Wrench,
  TrendingUp, Calendar, Eye, Image, RefreshCw, ArrowLeft, LogOut
} from 'lucide-react';

import ExcelJS from 'exceljs';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  timeline: string | null;
  config: any;
  total_cost: number | null;
  created_at: string;
}

interface PricingConfig {
  sqft_rate: number;
  flat_land_cost: number;
  bedroom_cost: number;
  bathroom_cost: number;
  home_types: {
    starter: { baseCost: number; baseArea: number };
    family: { baseCost: number; baseArea: number };
    premium: { baseCost: number; baseArea: number };
  };
  kitchen_costs: {
    standard: number;
    open: number;
    galley: number;
  };
  addon_costs: {
    solar: number;
    carport: number;
    water_tank: number;
    smart_home: number;
    fence: number;
    landscaping: number;
  };
  interest_rate_tiers: {
    upTo4M: number;
    upTo9M: number;
    upTo20M: number;
    upTo40M: number;
    upTo60M: number;
    above60M: number;
  };
  loyalty_discounts: {
    salary: number;
    home_start: number;
    credit_card: number;
    insurance: number;
    auto_loan: number;
    other_credit: number;
    investments: number;
  };
}

const DEFAULT_PRICING: PricingConfig = {
  sqft_rate: 145,
  flat_land_cost: 50000,
  bedroom_cost: 9500,
  bathroom_cost: 6800,
  home_types: {
    starter: { baseCost: 135000, baseArea: 900 },
    family: { baseCost: 245000, baseArea: 1400 },
    premium: { baseCost: 410000, baseArea: 2100 },
  },
  kitchen_costs: { standard: 8000, open: 14000, galley: 6500 },
  addon_costs: {
    solar: 12500,
    carport: 8500,
    water_tank: 4200,
    smart_home: 15800,
    fence: 15000,
    landscaping: 10000,
  },
  interest_rate_tiers: {
    upTo4M: 3.5,
    upTo9M: 3.7,
    upTo20M: 4.25,
    upTo40M: 4.75,
    upTo60M: 4.99,
    above60M: 6.5,
  },
  loyalty_discounts: {
    salary: 0.05,
    home_start: 0.05,
    credit_card: 0.10,
    insurance: 0.05,
    auto_loan: 0.10,
    other_credit: 0.10,
    investments: 0.05,
  },
};

type Tab = 'dashboard' | 'leads' | 'pricing' | 'layouts';


// ─── Main Component ──────────────────────────────────────────────────────────

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [presets, setPresets] = useState<any[]>([]);
  const [elevationImages, setElevationImages] = useState<any[]>([]);

  // ── Auth state (GBTI-WEB-04 fix) ─────────────────────────────────────────
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginStep, setLoginStep] = useState<'email' | 'otp'>('email');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginOtp, setLoginOtp] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Session verification on mount ─────────────────────────────────────────
  useEffect(() => {
    const verify = async () => {
      const token = localStorage.getItem('admin_session_token');
      if (!token) { setAuthChecked(true); setLoading(false); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.rpc as any)('verify_admin_session', { p_token: token });
      if (data) {
        setSessionToken(token);
        setIsAuthenticated(true);
      } else {
        localStorage.removeItem('admin_session_token');
        setLoading(false);
      }
      setAuthChecked(true);
    };
    verify();
  }, []);

  // ── Login handlers ────────────────────────────────────────────────────────
  const { executeRecaptcha } = useGoogleReCaptcha();

  const handleSendOtp = async () => {
    setLoginLoading(true);
    try {
      const captchaToken = executeRecaptcha ? await executeRecaptcha('admin_otp') : null;
      if (!captchaToken) { toast.error('CAPTCHA check failed. Please try again.'); setLoginLoading(false); return; }
      const { error } = await supabase.functions.invoke('captcha-otp', {
        body: { action: 'send_admin_otp', email: loginEmail.trim(), captchaToken },
      });
      if (error) toast.error('Failed to send OTP — check the email address.');
      else { setLoginStep('otp'); toast.success('OTP sent — check your email'); }
    } catch {
      toast.error('Failed to send OTP. Please try again.');
    }
    setLoginLoading(false);
  };

  const handleVerifyOtp = async () => {
    setLoginLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('verify_admin_login_otp', {
      p_otp: loginOtp.trim(),
      p_email: loginEmail.trim(),
    }) as { data: any; error: any };
    if (error || !data) {
      toast.error('Invalid or expired OTP');
    } else {
      localStorage.setItem('admin_session_token', (data as any).session_token);
      setSessionToken((data as any).session_token);
      setIsAuthenticated(true);
      toast.success('Logged in successfully');
    }
    setLoginLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_session_token');
    setSessionToken(null);
    setIsAuthenticated(false);
    setLeads([]);
    setLoginStep('email');
    setLoginOtp('');
  };

  // ── Data Fetching (via Edge Function for sensitive tables) ────────────────

  const fetchLeads = useCallback(async () => {
    const token = localStorage.getItem('admin_session_token');
    if (!token) return;
    const { data: result, error } = await supabase.functions.invoke('admin-api', {
      body: { action: 'get_leads' },
      headers: { 'x-session-token': token },
    });
    if (!error && result?.data) setLeads(result.data as Lead[]);
    else if (error) toast.error('Failed to load leads');
  }, []);

  const fetchPricing = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_pricing') as { data: any; error: any };
    if (!error && data?.value) {
      setPricing({ ...DEFAULT_PRICING, ...(data.value as any) });
    }
  }, []);

  const fetchPresets = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_presets') as { data: any[]; error: any };
    if (!error && data) setPresets(data);
  }, []);

  const fetchElevationImages = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_elevation_images') as { data: any[]; error: any };
    if (!error && data) setElevationImages(data);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchLeads(), fetchPricing(), fetchPresets(), fetchElevationImages()]);
      setLoading(false);
    };
    loadAll();
  }, [isAuthenticated, fetchLeads, fetchPricing, fetchPresets, fetchElevationImages]);

  // ── SEO ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    document.title = 'GBTI Admin · Dashboard';
  }, []);

  // ── Nav items ──────────────────────────────────────────────────────────────

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={18} /> },
    { id: 'leads', label: 'Leads', icon: <Users size={18} /> },
    { id: 'pricing', label: 'Pricing', icon: <DollarSign size={18} /> },
    { id: 'layouts', label: 'Layouts', icon: <Layout size={18} /> },
  ];

  // ── Login / auth-check screens ────────────────────────────────────────────
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 1 }}
          className="w-8 h-8 border-2 border-clay/20 border-t-clay rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm mx-auto p-8">
          <div className="text-center mb-8">
            <img src="/gbti-logo.png" alt="GBTI" className="h-10 mx-auto mb-4 object-contain" />
            <h1 className="font-display text-2xl font-semibold tracking-tight">Admin Login</h1>
            <p className="text-muted-foreground text-sm mt-1">Enter your admin email to receive an OTP</p>
          </div>
          {loginStep === 'email' ? (
            <div className="space-y-4">
              <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                placeholder="admin@example.com" autoFocus
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-clay/40 text-sm"
                onKeyDown={e => e.key === 'Enter' && handleSendOtp()} />
              <button onClick={handleSendOtp} disabled={loginLoading || !loginEmail.trim()}
                className="w-full py-3 rounded-xl bg-clay text-white font-medium text-sm hover:bg-clay/90 disabled:opacity-50 transition-all">
                {loginLoading ? 'Sending...' : 'Send OTP'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">OTP sent to <strong>{loginEmail}</strong></p>
              <input type="text" value={loginOtp} onChange={e => setLoginOtp(e.target.value)}
                placeholder="6-digit OTP" maxLength={6} autoFocus
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-clay/40 text-sm text-center tracking-widest text-lg"
                onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()} />
              <button onClick={handleVerifyOtp} disabled={loginLoading || loginOtp.length < 6}
                className="w-full py-3 rounded-xl bg-clay text-white font-medium text-sm hover:bg-clay/90 disabled:opacity-50 transition-all">
                {loginLoading ? 'Verifying...' : 'Verify OTP'}
              </button>
              <button onClick={() => setLoginStep('email')} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
                &larr; Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 72 : 260 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="fixed left-0 top-0 bottom-0 z-40 bg-ink text-white flex flex-col overflow-hidden"
      >
        {/* Logo */}
        <div className="p-5 border-b border-white/10 flex items-center gap-3">
          <img
            src="/gbti-logo.png"
            alt="GBTI Logo"
            className={`w-auto object-contain flex-shrink-0 transition-all ${sidebarCollapsed ? 'h-6 max-w-[32px]' : 'h-8 max-w-[140px]'}`}
          />
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap"
              >
                <div className="font-display font-bold tracking-wide text-sm">GBTI</div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">Admin Panel</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-3">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 text-sm ${
                activeTab === item.id
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <AnimatePresence>
                {!sidebarCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="overflow-hidden whitespace-nowrap font-medium"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 pt-2">
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/50 hover:text-red-400 hover:bg-white/5 transition-all text-sm">
            <LogOut size={18} className="flex-shrink-0" />
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="whitespace-nowrap font-medium">Logout</motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>

        {/* Back to app */}
        <div className="p-3 border-t border-white/10">
          <a
            href={import.meta.env.VITE_MAIN_APP_URL || "http://localhost:8080"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/50 hover:text-white/80 hover:bg-white/5 transition-all text-sm"
          >
            <ArrowLeft size={18} className="flex-shrink-0" />
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="whitespace-nowrap font-medium"
                >
                  Open Main App
                </motion.span>
              )}
            </AnimatePresence>
          </a>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute top-1/2 -right-3 w-6 h-6 rounded-full bg-ink border-2 border-background flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </motion.aside>

      {/* Main content */}
      <motion.main
        initial={false}
        animate={{ marginLeft: sidebarCollapsed ? 72 : 260 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex-1 min-h-screen"
      >
        {loading ? (
          <div className="flex items-center justify-center h-screen">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, ease: 'linear', duration: 1 }}
              className="w-8 h-8 border-2 border-clay/20 border-t-clay rounded-full"
            />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && <DashboardTab key="dashboard" leads={leads} />}
            {activeTab === 'leads' && <LeadsTab key="leads" leads={leads} onRefresh={fetchLeads} sessionToken={sessionToken} />}
            {activeTab === 'pricing' && <PricingTab key="pricing" pricing={pricing} onSave={setPricing} />}
            {activeTab === 'layouts' && <LayoutsTab key="layouts" presets={presets} elevationImages={elevationImages} onRefresh={() => { fetchPresets(); fetchElevationImages(); }} />}
          </AnimatePresence>
        )}
      </motion.main>
    </div>
  );
};

// ─── Tab Wrapper ─────────────────────────────────────────────────────────────

const TabWrapper = ({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    className="p-6 md:p-8 max-w-[1400px] mx-auto"
  >
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
    {children}
  </motion.div>
);

// ─── Stat Card ───────────────────────────────────────────────────────────────

const StatCard = ({ label, value, icon, accent = false }: { label: string; value: string | number; icon: React.ReactNode; accent?: boolean }) => (
  <div className={`rounded-2xl border p-5 transition-all ${accent ? 'bg-clay/5 border-clay/20' : 'bg-surface border-border'}`}>
    <div className="flex items-center justify-between mb-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">{label}</span>
      <span className={accent ? 'text-clay' : 'text-muted-foreground/40'}>{icon}</span>
    </div>
    <div className="font-display text-2xl font-semibold tracking-tight">{value}</div>
  </div>
);

// ─── Dashboard Tab ───────────────────────────────────────────────────────────

const DashboardTab = ({ leads }: { leads: Lead[] }) => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const leadsThisWeek = leads.filter((l) => new Date(l.created_at) >= weekAgo).length;
  const leadsThisMonth = leads.filter((l) => new Date(l.created_at) >= monthAgo).length;
  const totalRevenue = leads.reduce((sum, l) => sum + (l.total_cost || 0), 0);

  const homeTypeDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => {
      const ht = l.config?.home_type || 'unknown';
      counts[ht] = (counts[ht] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), count }));
  }, [leads]);

  const timelineDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => {
      const tl = l.timeline || 'Not specified';
      counts[tl] = (counts[tl] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [leads]);

  const maxHomeType = Math.max(...homeTypeDistribution.map((d) => d.count), 1);
  const maxTimeline = Math.max(...timelineDistribution.map((d) => d.count), 1);

  return (
    <TabWrapper title="Dashboard" subtitle="Overview of your lead pipeline and statistics">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Leads" value={leads.length} icon={<Users size={16} />} accent />
        <StatCard label="This Week" value={leadsThisWeek} icon={<Calendar size={16} />} />
        <StatCard label="This Month" value={leadsThisMonth} icon={<TrendingUp size={16} />} />
        <StatCard label="Pipeline Value" value={formatMoney(totalRevenue)} icon={<DollarSign size={16} />} accent />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Home Type Chart */}
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-6">Home Type Distribution</h3>
          <div className="space-y-4">
            {homeTypeDistribution.map((d) => (
              <div key={d.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-foreground">{d.name}</span>
                  <span className="text-sm font-display font-semibold text-clay">{d.count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(d.count / maxHomeType) * 100}%` }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                    className="h-full rounded-full bg-gradient-to-r from-clay/80 to-clay"
                  />
                </div>
              </div>
            ))}
            {homeTypeDistribution.length === 0 && (
              <p className="text-sm text-muted-foreground/50 text-center py-4">No data yet</p>
            )}
          </div>
        </div>

        {/* Timeline Chart */}
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-6">Timeline Preferences</h3>
          <div className="space-y-4">
            {timelineDistribution.map((d) => (
              <div key={d.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-foreground">{d.name}</span>
                  <span className="text-sm font-display font-semibold text-foreground/70">{d.count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(d.count / maxTimeline) * 100}%` }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                    className="h-full rounded-full bg-gradient-to-r from-ink/60 to-ink/90"
                  />
                </div>
              </div>
            ))}
            {timelineDistribution.length === 0 && (
              <p className="text-sm text-muted-foreground/50 text-center py-4">No data yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Leads */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">Recent Leads</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Name</th>
                <th className="text-left pb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Email</th>
                <th className="text-left pb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Home Type</th>
                <th className="text-right pb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Est. Cost</th>
                <th className="text-right pb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Date</th>
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 8).map((l) => (
                <tr key={l.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 font-medium text-foreground">{l.name}</td>
                  <td className="py-3 text-muted-foreground">{l.email}</td>
                  <td className="py-3">
                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-clay/10 text-clay">
                      {l.config?.home_type || '—'}
                    </span>
                  </td>
                  <td className="py-3 text-right font-display font-semibold">{l.total_cost ? formatMoney(l.total_cost) : '—'}</td>
                  <td className="py-3 text-right text-muted-foreground text-xs">{new Date(l.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground/50">No leads yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TabWrapper>
  );
};

// ─── Leads Tab ───────────────────────────────────────────────────────────────

const LeadsTab = ({ leads, onRefresh, sessionToken }: { leads: Lead[]; onRefresh: () => Promise<void>; sessionToken: string | null }) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showEmailModal, setShowEmailModal] = useState(false);


  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [viewLead, setViewLead] = useState<Lead | null>(null);

  const exportLeads = async () => {
    if (leads.length === 0) {
      toast.error('No leads to export');
      return;
    }

    const rows = leads.map((l) => ({
      ID: l.id,
      Name: l.name,
      Email: l.email,
      Phone: l.phone,
      'Home Type': l.config?.home_type || '',
      Bedrooms: l.config?.bedrooms || '',
      Bathrooms: l.config?.bathrooms || '',
      Kitchen: l.config?.kitchen || '',
      'Add-ons': (l.config?.addons || []).join(', '),
      'Total Cost': l.total_cost || 0,
      'Created At': new Date(l.created_at).toLocaleString(),
    }));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');

    // Define columns and auto-size widths based on content
    const keys = Object.keys(rows[0] || {});
    ws.columns = keys.map((key) => ({
      header: key,
      key: key,
      width: Math.max(key.length, ...rows.map((r) => String((r as any)[key]).length)) + 2,
    }));

    // Add data rows
    ws.addRows(rows);

    // Style the header row
    ws.getRow(1).font = { bold: true };

    // Export the workbook
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GBTI_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${rows.length} leads to Excel`);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter((l) =>
      l.name.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      l.phone.toLowerCase().includes(q) ||
      (l.config?.home_type || '').toLowerCase().includes(q)
    );
  }, [leads, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l) => l.id)));
    }
  };

  const deleteLead = async (id: string) => {
    if (!confirm('Delete this lead permanently?')) return;
    if (!sessionToken) { toast.error('Session expired — please log in again'); return; }
    const { error } = await supabase.functions.invoke('admin-api', {
      body: { action: 'delete_lead', payload: { id } },
      headers: { 'x-session-token': sessionToken },
    });
    if (error) toast.error('Failed to delete');
    else {
      toast.success('Lead deleted');
      await onRefresh();
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const exportToExcel = () => {
    const toExport = selected.size > 0 ? leads.filter((l) => selected.has(l.id)) : filtered;
    const rows = toExport.map((l) => ({
      Name: l.name,
      Email: l.email,
      Phone: l.phone,
      Timeline: l.timeline || '',
      'Home Type': l.config?.home_type || '',
      Bedrooms: l.config?.bedrooms || '',
      Bathrooms: l.config?.bathrooms || '',
      Kitchen: l.config?.kitchen || '',
      'Add-ons': (l.config?.addons || []).join(', '),
      'Total Cost': l.total_cost || 0,
      'Created At': new Date(l.created_at).toLocaleString(),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    // Auto-size columns
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String((r as any)[key]).length)) + 2,
    }));
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `GBTI_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exported ${rows.length} leads to Excel`);
  };

  const sendBulkEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast.error('Please fill in subject and body');
      return;
    }

    const selectedLeads = leads.filter((l) => selected.has(l.id));
    if (selectedLeads.length === 0) {
      toast.error('No leads selected');
      return;
    }

    setSendingEmail(true);

    // All Brevo credentials are server-side in the send-email Edge Function
    // We send one batch request with all recipients instead of per-lead fetches
    const token = localStorage.getItem('admin_session_token');
    let sent = 0;
    let failed = 0;

    for (const lead of selectedLeads) {
      try {
        const htmlContent = `
          <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;max-width:640px;margin:0 auto;padding:24px;">
            <p>Hi ${lead.name},</p>
            <div style="margin:16px 0;white-space:pre-wrap;">${emailBody.replace(/\n/g, '<br/>')}</div>
            <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="font-size:12px;color:#9ca3af;">Sent by GBTI Architectural Team</p>
          </div>
        `;
        const textContent = `Hi ${lead.name},\n\n${emailBody}\n\n--\nGBTI Architectural Team`;

        const { data: result, error } = await supabase.functions.invoke('send-email', {
          body: {
            recipients: [{ email: lead.email, name: lead.name }],
            subject: emailSubject,
            htmlContent,
            textContent,
          },
          headers: token ? { 'x-session-token': token } : {},
        });

        if (error || !result?.ok) failed++;
        else sent += result.sent ?? 1;
      } catch {
        failed++;
      }
    }

    setSendingEmail(false);
    setShowEmailModal(false);
    setEmailSubject('');
    setEmailBody('');
    toast.success(`Sent: ${sent} | Failed: ${failed}`);
  };


  return (
    <TabWrapper
      title="Leads Management"
      subtitle={`${leads.length} total leads · ${selected.size} selected`}
      actions={
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="p-2.5 rounded-xl border border-border bg-surface hover:bg-muted/30 transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={exportToExcel}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface text-sm font-medium hover:bg-muted/30 transition-colors disabled:opacity-30"
          >
            <Download size={14} /> Export
          </button>
          <button
            onClick={() => setShowEmailModal(true)}
            disabled={selected.size === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-clay text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-30"
          >
            <Mail size={14} /> Send Email ({selected.size})
          </button>
        </div>
      }
    >
      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, phone, or home type…"
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-surface text-sm outline-none focus:border-clay/40 transition-colors"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="pl-4 pr-2 py-3 text-left w-10">
                  <button onClick={selectAll} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                    {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Name</th>
                <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Email</th>
                <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Phone</th>
                <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Home</th>
                <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Timeline</th>
                <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Cost</th>
                <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Date</th>
                <th className="px-3 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className={`border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors ${selected.has(l.id) ? 'bg-clay/5' : ''}`}>
                  <td className="pl-4 pr-2 py-3">
                    <button onClick={() => toggleSelect(l.id)} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                      {selected.has(l.id) ? <CheckSquare size={16} className="text-clay" /> : <Square size={16} />}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-medium text-foreground">{l.name}</td>
                  <td className="px-3 py-3 text-muted-foreground">{l.email}</td>
                  <td className="px-3 py-3 text-muted-foreground">{l.phone}</td>
                  <td className="px-3 py-3">
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-clay/10 text-clay">
                      {l.config?.home_type || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs">{l.timeline || '—'}</td>
                  <td className="px-3 py-3 text-right font-display font-semibold">{l.total_cost ? formatMoney(l.total_cost) : '—'}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground text-xs">{new Date(l.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setViewLead(l)} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground/50 hover:text-foreground transition-colors" title="View">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => deleteLead(l.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground/50">No leads found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead Detail Modal */}
      <AnimatePresence>
        {viewLead && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setViewLead(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-2xl border border-border max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-display text-xl font-semibold">Lead Details</h3>
                <button onClick={() => setViewLead(null)} className="p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <DetailRow label="Name" value={viewLead.name} />
                <DetailRow label="Email" value={viewLead.email} />
                <DetailRow label="Phone" value={viewLead.phone} />
                <DetailRow label="Timeline" value={viewLead.timeline || '—'} />
                <DetailRow label="Total Cost" value={viewLead.total_cost ? formatMoney(viewLead.total_cost) : '—'} />
                <DetailRow label="Home Type" value={viewLead.config?.home_type || '—'} />
                <DetailRow label="Bedrooms" value={viewLead.config?.bedrooms || '—'} />
                <DetailRow label="Bathrooms" value={viewLead.config?.bathrooms || '—'} />
                <DetailRow label="Kitchen" value={viewLead.config?.kitchen || '—'} />
                <DetailRow label="Roof" value={viewLead.config?.roof || '—'} />
                <DetailRow label="Material" value={viewLead.config?.material || '—'} />
                <DetailRow label="Land" value={viewLead.config?.land || '—'} />
                <DetailRow label="Add-ons" value={(viewLead.config?.addons || []).join(', ') || 'None'} />
                <DetailRow label="Double Storey" value={viewLead.config?.is_double_storey ? 'Yes' : 'No'} />
                <DetailRow label="Submitted" value={new Date(viewLead.created_at).toLocaleString()} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Email Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !sendingEmail && setShowEmailModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-2xl border border-border max-w-xl w-full p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-display text-xl font-semibold">Send Bulk Email</h3>
                <button onClick={() => !sendingEmail && setShowEmailModal(false)} className="p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
                  <X size={18} />
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Sending to <strong className="text-foreground">{selected.size}</strong> selected lead{selected.size !== 1 ? 's' : ''}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-2 block">Subject</label>
                  <input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Email subject line…"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-sm outline-none focus:border-clay/40 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-2 block">Body</label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Type your email content here…"
                    rows={8}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-sm outline-none focus:border-clay/40 transition-colors resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  onClick={() => !sendingEmail && setShowEmailModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendBulkEmail}
                  disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-clay text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-30"
                >
                  {sendingEmail ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 1 }} className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full" />
                  ) : (
                    <Send size={14} />
                  )}
                  {sendingEmail ? 'Sending…' : `Send to ${selected.size}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </TabWrapper>
  );
};

// ─── Detail Row ──────────────────────────────────────────────────────────────

const DetailRow = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
    <span className="text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
    <span className="font-medium text-foreground">{value}</span>
  </div>
);

// ─── Pricing Tab ─────────────────────────────────────────────────────────────

const PricingTab = ({ pricing, onSave }: { pricing: PricingConfig; onSave: (p: PricingConfig) => void }) => {
  const [local, setLocal] = useState<PricingConfig>(pricing);
  const [saving, setSaving] = useState(false);

  useEffect(() => setLocal(pricing), [pricing]);

  const save = async () => {
    setSaving(true);
    const token = localStorage.getItem('admin_session_token');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('admin_update_pricing', {
      p_token: token,
      p_value: local,
    });
    setSaving(false);
    if (error) toast.error('Failed to save pricing');
    else {
      toast.success('Pricing saved');
      onSave(local);
    }
  };

  const updateField = (path: string, value: number) => {
    setLocal((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = clone;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return clone;
    });
  };

  return (
    <TabWrapper
      title="Pricing Settings"
      subtitle="Configure all pricing rates and costs. Changes are saved to the database."
      actions={
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-clay text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-30"
        >
          {saving ? (
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 1 }} className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full" />
          ) : (
            <Settings size={14} />
          )}
          {saving ? 'Saving…' : 'Save All'}
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Base Rates */}
        <PricingCard title="Base Rates" icon={<DollarSign size={16} />}>
          <PriceInput label="Construction Rate (per sqft)" value={local.sqft_rate} onChange={(v) => updateField('sqft_rate', v)} prefix="$" />
          <PriceInput label="Flat Land Cost" value={local.flat_land_cost || 0} onChange={(v) => updateField('flat_land_cost', v)} prefix="$" />
          <PriceInput label="Bedroom Cost (per unit)" value={local.bedroom_cost} onChange={(v) => updateField('bedroom_cost', v)} prefix="$" />
          <PriceInput label="Bathroom Cost (per unit)" value={local.bathroom_cost} onChange={(v) => updateField('bathroom_cost', v)} prefix="$" />
        </PricingCard>

        {/* Home Type Prices */}
        <PricingCard title="Home Type Base Costs" icon={<Home size={16} />}>
          <PriceInput label="Starter Base Cost" value={local.home_types.starter.baseCost} onChange={(v) => updateField('home_types.starter.baseCost', v)} prefix="$" />
          <PriceInput label="Starter Base Area (sqft)" value={local.home_types.starter.baseArea} onChange={(v) => updateField('home_types.starter.baseArea', v)} />
          <PriceInput label="Family Base Cost" value={local.home_types.family.baseCost} onChange={(v) => updateField('home_types.family.baseCost', v)} prefix="$" />
          <PriceInput label="Family Base Area (sqft)" value={local.home_types.family.baseArea} onChange={(v) => updateField('home_types.family.baseArea', v)} />
          <PriceInput label="Premium Base Cost" value={local.home_types.premium.baseCost} onChange={(v) => updateField('home_types.premium.baseCost', v)} prefix="$" />
          <PriceInput label="Premium Base Area (sqft)" value={local.home_types.premium.baseArea} onChange={(v) => updateField('home_types.premium.baseArea', v)} />
        </PricingCard>

        {/* Kitchen Costs */}
        <PricingCard title="Kitchen Costs" icon={<Wrench size={16} />}>
          <PriceInput label="Standard Kitchen" value={local.kitchen_costs.standard} onChange={(v) => updateField('kitchen_costs.standard', v)} prefix="$" />
          <PriceInput label="Open Kitchen" value={local.kitchen_costs.open} onChange={(v) => updateField('kitchen_costs.open', v)} prefix="$" />
          <PriceInput label="Galley Kitchen" value={local.kitchen_costs.galley} onChange={(v) => updateField('kitchen_costs.galley', v)} prefix="$" />
        </PricingCard>

        {/* Add-on Costs */}
        <PricingCard title="Add-on / Amenity Costs" icon={<Wrench size={16} />}>
          <PriceInput label="Solar Panels" value={local.addon_costs.solar} onChange={(v) => updateField('addon_costs.solar', v)} prefix="$" />
          <PriceInput label="Carport" value={local.addon_costs.carport} onChange={(v) => updateField('addon_costs.carport', v)} prefix="$" />
          <PriceInput label="Water Tank" value={local.addon_costs.water_tank} onChange={(v) => updateField('addon_costs.water_tank', v)} prefix="$" />
          <PriceInput label="Smart Home Package" value={local.addon_costs.smart_home} onChange={(v) => updateField('addon_costs.smart_home', v)} prefix="$" />
          <PriceInput label="Perimeter Fence/Bridge" value={local.addon_costs.fence} onChange={(v) => updateField('addon_costs.fence', v)} prefix="$" />
          <PriceInput label="Furniture" value={local.addon_costs.landscaping} onChange={(v) => updateField('addon_costs.landscaping', v)} prefix="$" />
        </PricingCard>

        {/* Interest Rate Tiers */}
        <PricingCard title="Interest Rate Tiers" icon={<DollarSign size={16} />}>
          <PriceInput label="Up to $4M" value={local.interest_rate_tiers?.upTo4M ?? 3.5} onChange={(v) => updateField('interest_rate_tiers.upTo4M', v)} suffix="%" />
          <PriceInput label="$4M - $9M" value={local.interest_rate_tiers?.upTo9M ?? 3.7} onChange={(v) => updateField('interest_rate_tiers.upTo9M', v)} suffix="%" />
          <PriceInput label="$9M - $20M" value={local.interest_rate_tiers?.upTo20M ?? 4.25} onChange={(v) => updateField('interest_rate_tiers.upTo20M', v)} suffix="%" />
          <PriceInput label="$20M - $40M" value={local.interest_rate_tiers?.upTo40M ?? 4.75} onChange={(v) => updateField('interest_rate_tiers.upTo40M', v)} suffix="%" />
          <PriceInput label="$40M - $60M" value={local.interest_rate_tiers?.upTo60M ?? 4.99} onChange={(v) => updateField('interest_rate_tiers.upTo60M', v)} suffix="%" />
          <PriceInput label="Above $60M" value={local.interest_rate_tiers?.above60M ?? 6.5} onChange={(v) => updateField('interest_rate_tiers.above60M', v)} suffix="%" />
        </PricingCard>

        {/* Loyalty Discounts */}
        <PricingCard title="Loyalty Discounts" icon={<DollarSign size={16} />}>
          <PriceInput label="Salary Assignment" value={local.loyalty_discounts?.salary ?? 0.05} onChange={(v) => updateField('loyalty_discounts.salary', v)} suffix="%" />
          <PriceInput label="Home Start Advantage" value={local.loyalty_discounts?.home_start ?? 0.05} onChange={(v) => updateField('loyalty_discounts.home_start', v)} suffix="%" />
          <PriceInput label="Credit Card" value={local.loyalty_discounts?.credit_card ?? 0.10} onChange={(v) => updateField('loyalty_discounts.credit_card', v)} suffix="%" />
          <PriceInput label="Insurance" value={local.loyalty_discounts?.insurance ?? 0.05} onChange={(v) => updateField('loyalty_discounts.insurance', v)} suffix="%" />
          <PriceInput label="Auto Loan" value={local.loyalty_discounts?.auto_loan ?? 0.10} onChange={(v) => updateField('loyalty_discounts.auto_loan', v)} suffix="%" />
          <PriceInput label="Other Credit" value={local.loyalty_discounts?.other_credit ?? 0.10} onChange={(v) => updateField('loyalty_discounts.other_credit', v)} suffix="%" />
          <PriceInput label="Investments" value={local.loyalty_discounts?.investments ?? 0.05} onChange={(v) => updateField('loyalty_discounts.investments', v)} suffix="%" />
        </PricingCard>
      </div>
    </TabWrapper>
  );
};

const PricingCard = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-surface p-6">
    <div className="flex items-center gap-2 mb-5">
      <span className="text-clay">{icon}</span>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">{title}</h3>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

const PriceInput = ({ label, value, onChange, prefix, suffix }: { label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string }) => (
  <div className="flex items-center justify-between gap-4">
    <label className="text-sm text-foreground/80 flex-1">{label}</label>
    <div className="flex items-center gap-1 bg-background rounded-lg border border-border px-3 py-1.5 w-36">
      {prefix && <span className="text-muted-foreground/50 text-sm">{prefix}</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full bg-transparent outline-none text-sm font-display font-semibold text-right"
      />
      {suffix && <span className="text-muted-foreground/50 text-sm">{suffix}</span>}
    </div>
  </div>
);

// ─── Layouts Tab ─────────────────────────────────────────────────────────────

const LayoutsTab = ({ presets, elevationImages, onRefresh }: { presets: any[]; elevationImages: any[]; onRefresh: () => void }) => {
  const deletePreset = async (id: string) => {
    if (!confirm('Delete this preset permanently?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('delete_preset', { p_id: id });
    if (error) toast.error('Failed to delete preset');
    else { toast.success('Preset deleted'); onRefresh(); }
  };

  const deleteElevation = async (id: string) => {
    if (!confirm('Delete this elevation image?')) return;
    const token = localStorage.getItem('admin_session_token');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('admin_delete_elevation_image', { p_token: token, p_id: id });
    if (error) toast.error('Failed to delete');
    else { toast.success('Elevation image deleted'); onRefresh(); }
  };

  const uploadElevation = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const presetKey = prompt('Enter the preset key for this elevation image:', '');
    if (!presetKey?.trim()) return;

    const filePath = `elevations/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('elevation-images')
      .upload(filePath, file);

    if (uploadError) {
      // If bucket doesn't exist, fall back to using a data URL
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const token = localStorage.getItem('admin_session_token');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)('admin_insert_elevation_image', {
          p_token: token, p_preset_key: presetKey.trim(),
          p_image_path: filePath, p_image_url: dataUrl,
        });
        if (error) toast.error('Failed to save');
        else { toast.success('Elevation image uploaded'); onRefresh(); }
      };
      reader.readAsDataURL(file);
      return;
    }

    const { data: urlData } = supabase.storage.from('elevation-images').getPublicUrl(filePath);
    const token = localStorage.getItem('admin_session_token');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('admin_insert_elevation_image', {
      p_token: token, p_preset_key: presetKey.trim(),
      p_image_path: filePath, p_image_url: urlData.publicUrl,
    });
    if (error) toast.error('Failed to save');
    else { toast.success('Elevation image uploaded'); onRefresh(); }
  };

  return (
    <TabWrapper
      title="Layouts & Elevations"
      subtitle={`${presets.length} presets · ${elevationImages.length} elevation images`}
      actions={
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="p-2.5 rounded-xl border border-border bg-surface hover:bg-muted/30 transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-clay text-white text-sm font-medium hover:brightness-110 transition-all cursor-pointer">
            <Image size={14} /> Upload Elevation
            <input type="file" accept="image/*" onChange={uploadElevation} className="hidden" />
          </label>
        </div>
      }
    >
      {/* Presets */}
      <div className="mb-8">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">Saved Presets</h3>
        {presets.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground/50">
            No presets saved yet
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {presets.map((p) => (
              <div key={p.id} className="rounded-2xl border border-border bg-surface p-5 group hover:border-clay/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground/50 mt-0.5">{new Date(p.created_at).toLocaleDateString()}</div>
                  </div>
                  <button
                    onClick={() => deletePreset(p.id)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-clay/60">
                  {p.plan_data?.ground?.rooms?.length || 0} rooms
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Elevation Images */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">Elevation Images</h3>
        {elevationImages.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground/50">
            No elevation images uploaded yet
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {elevationImages.map((img) => (
              <div key={img.id} className="rounded-2xl border border-border bg-surface overflow-hidden group hover:border-clay/30 transition-colors">
                <div className="h-40 bg-muted/20 overflow-hidden">
                  <img
                    src={img.image_url}
                    alt={img.preset_key}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).alt = 'Image not found'; }}
                  />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground/60 truncate" title={img.preset_key}>{img.preset_key}</div>
                      <div className="text-[10px] text-muted-foreground/40 mt-0.5">{new Date(img.created_at).toLocaleDateString()}</div>
                    </div>
                    <button
                      onClick={() => deleteElevation(img.id)}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TabWrapper>
  );
};

export default AdminDashboard;
