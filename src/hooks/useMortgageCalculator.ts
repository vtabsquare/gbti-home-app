import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateEMI, generateAmortizationSchedule, AmortizationRow } from '@/utils/finance';
import { useConfig } from '@/store/configurator';

export interface MortgageSettings {
  default_interest_rate: number;
  min_interest_rate: number;
  max_interest_rate: number;
  default_tenure: number;
  min_tenure: number;
  max_tenure: number;
  min_down_payment_percent: number;
  max_ltv: number;
}

const DEFAULT_SETTINGS: MortgageSettings = {
  default_interest_rate: 6.5,
  min_interest_rate: 2.0,
  max_interest_rate: 15.0,
  default_tenure: 25,
  min_tenure: 5,
  max_tenure: 40,
  min_down_payment_percent: 10.0,
  max_ltv: 90.0
};

export function useMortgageCalculator(totalPropertyPrice: number) {
  const [settings, setSettings] = useState<MortgageSettings>(DEFAULT_SETTINGS);
  const [interestTiers, setInterestTiers] = useState<any>(null);
  const [loyaltyDiscountsConfig, setLoyaltyDiscountsConfig] = useState<any>(null);
  
  // User adjustable states mapped to global config store
  const interestRate = useConfig(s => s.interestRate);
  const setInterestRate = useConfig(s => s.setInterestRate);
  const tenureYears = useConfig(s => s.tenureYears);
  const setTenureYears = useConfig(s => s.setTenureYears);
  const downPaymentPercent = useConfig(s => s.downPaymentPercent);
  const setDownPaymentPercent = useConfig(s => s.setDownPaymentPercent);
  const loyaltyProducts = useConfig(s => s.loyaltyProducts);

  // Fetch admin settings on mount
  useEffect(() => {
    async function fetchSettings() {
      try {
        const [mortgageRes, pricingRes] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.rpc as any)('get_mortgage_settings') as Promise<{ data: any; error: any }>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.rpc as any)('get_pricing') as Promise<{ data: any; error: any }>,
        ]);
        
        if (!mortgageRes.error && mortgageRes.data) {
          setSettings(mortgageRes.data);
          // Only update global state if they are currently at their hardcoded defaults
          const currentStore = useConfig.getState();
          if (currentStore.interestRate === 6.5) {
            setInterestRate(mortgageRes.data.default_interest_rate);
          }
          if (currentStore.tenureYears === 25) {
            setTenureYears(mortgageRes.data.default_tenure);
          }
          if (currentStore.downPaymentPercent === 10) {
            setDownPaymentPercent(mortgageRes.data.min_down_payment_percent);
          }
        }

        if (!pricingRes.error && pricingRes.data?.value) {
          if (pricingRes.data.value.interest_rate_tiers) {
            setInterestTiers(pricingRes.data.value.interest_rate_tiers);
          }
          if (pricingRes.data.value.loyalty_discounts) {
            setLoyaltyDiscountsConfig(pricingRes.data.value.loyalty_discounts);
          }
        }
      } catch (e) {
        console.error('Failed to fetch settings:', e);
      }
    }
    fetchSettings();
  }, []);

  // Compute derived values
  const downPayment = Math.round(totalPropertyPrice * (downPaymentPercent / 100));
  const loanAmount = Math.max(0, totalPropertyPrice - downPayment);
  
  // Calculate base interest rate based on loan amount tiers
  let calculatedBaseRate = 6.5;
  const tiers = interestTiers || {
    upTo4M: 3.5,
    upTo9M: 3.7,
    upTo20M: 4.25,
    upTo40M: 4.75,
    upTo60M: 4.99,
    above60M: 6.5
  };
  
  if (loanAmount <= 4000000) {
    calculatedBaseRate = tiers.upTo4M;
  } else if (loanAmount <= 9000000) {
    calculatedBaseRate = tiers.upTo9M;
  } else if (loanAmount <= 20000000) {
    calculatedBaseRate = tiers.upTo20M;
  } else if (loanAmount <= 40000000) {
    calculatedBaseRate = tiers.upTo40M;
  } else if (loanAmount <= 60000000) {
    calculatedBaseRate = tiers.upTo60M;
  } else {
    calculatedBaseRate = tiers.above60M; // Above $60M
  }

  const dynLoyalty = loyaltyDiscountsConfig || {
    salary: 0.05,
    home_start: 0.05,
    credit_card: 0.10,
    insurance: 0.05,
    auto_loan: 0.10,
    other_credit: 0.10,
    investments: 0.05,
  };

  const LOYALTY_DISCOUNTS: Record<string, number> = {
    'Salary Assignment': dynLoyalty.salary,
    'Home Start Advantage': dynLoyalty.home_start,
    'Credit Card': dynLoyalty.credit_card,
    'Insurance': dynLoyalty.insurance,
    'Auto Loan': dynLoyalty.auto_loan,
    'Other Credit': dynLoyalty.other_credit,
    'Investments': dynLoyalty.investments,
  };
  
  const loyaltyOptions = [
    { id: 'Salary Assignment', label: 'Salary Assignment', discount: dynLoyalty.salary },
    { id: 'Home Start Advantage', label: 'Home Start Advantage', discount: dynLoyalty.home_start },
    { id: 'Credit Card', label: 'Credit Card', discount: dynLoyalty.credit_card },
    { id: 'Insurance', label: 'Insurance', discount: dynLoyalty.insurance },
    { id: 'Auto Loan', label: 'Auto Loan', discount: dynLoyalty.auto_loan },
    { id: 'Other Credit', label: 'Other Credit', discount: dynLoyalty.other_credit },
    { id: 'Investments', label: 'Investments', discount: dynLoyalty.investments },
  ];

  const loyaltyDiscountRate = loyaltyProducts.reduce((sum, p) => sum + (LOYALTY_DISCOUNTS[p] || 0), 0);
  const effectiveInterestRate = Math.max(0, calculatedBaseRate - loyaltyDiscountRate);

  // Sync effective interest rate into global config so CostPanel (right sidebar) uses the same rate
  const prevEffectiveRateRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevEffectiveRateRef.current !== effectiveInterestRate) {
      prevEffectiveRateRef.current = effectiveInterestRate;
      setInterestRate(effectiveInterestRate);
    }
  }, [effectiveInterestRate, setInterestRate]);

  const baseEmi = useMemo(() => calculateEMI(loanAmount, calculatedBaseRate, tenureYears), [loanAmount, calculatedBaseRate, tenureYears]);
  const emi = useMemo(() => calculateEMI(loanAmount, effectiveInterestRate, tenureYears), [loanAmount, effectiveInterestRate, tenureYears]);
  const amortizationSchedule = useMemo(() => generateAmortizationSchedule(loanAmount, effectiveInterestRate, tenureYears), [loanAmount, effectiveInterestRate, tenureYears]);

  return {
    settings,
    
    // User controls
    baseInterestRate: interestRate,
    interestRate: effectiveInterestRate,
    setInterestRate,
    tenureYears,
    setTenureYears,
    downPaymentPercent,
    setDownPaymentPercent,
    
    // Calculated values
    downPayment,
    loanAmount,
    baseEmi,
    emi,
    amortizationSchedule,
    loyaltyOptions
  };
}
