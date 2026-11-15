'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';

export interface FeeAccount { id: string; code: string; name: string; accountType: string; systemKey: string | null }
export interface FeeHead {
  id: string; name: string; code: string; feeType: string; isRefundable: boolean; gstApplicable: boolean; status: string;
  incomeAccount: { id: string; code: string; name: string };
}
export interface FeeOptions {
  years: { id: string; name: string; isCurrent: boolean; status: string; startDate: string }[];
  campuses: { id: string; code: string; name: string }[];
  programs: { id: string; name: string; code: string; campusId: string; levels: { id: string; name: string }[] }[];
  heads: FeeHead[];
  accounts: FeeAccount[];
}

/** Years, classes, fee heads and postable accounts for the fee screens (GET /fees/setup/options). */
export function useFeeOptions() {
  const [opts, setOpts] = useState<FeeOptions | null>(null);
  const reload = useCallback(() => {
    api<FeeOptions>('/fees/setup/options').then(setOpts).catch(() => setOpts({ years: [], campuses: [], programs: [], heads: [], accounts: [] }));
  }, []);
  useEffect(reload, [reload]);
  return { opts, reload };
}

/** "41000.5" (API decimal) → paise; empty or invalid → 0. */
export const paiseOf = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return 0;
  try { return toPaise(v); } catch { return 0; }
};

/** ₹ amount from an API decimal string, in Indian grouping. */
export function Money({ value, className }: { value: string | number | null | undefined; className?: string }) {
  return <span className={`money ${className ?? ''}`}>{formatINR(paiseOf(value))}</span>;
}

/** Text typed into an amount box is valid when empty or a rupee amount with ≤ 2 decimals. */
export const amountOk = (v: string) => v.trim() === '' || /^\d{1,12}(\.\d{1,2})?$/.test(v.replace(/,/g, '').trim());
