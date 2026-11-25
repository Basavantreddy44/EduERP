import { z } from 'zod';

/**
 * Phase 22 — SaaS billing (CD-126, CD-133–CD-136): what the platform charges each institution.
 * Prices per plan (and edition), monthly or yearly by the institution's choice, GST invoices per term,
 * payments recorded by platform staff, renewal, reminders, grace and read-only after the grace days.
 */
const date = z.string().date('Enter a date');
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const money = z.number().positive('Enter an amount').max(99_999_999.99).multipleOf(0.01, 'Up to 2 decimals');

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const PLATFORM_INVOICE_STATUSES = ['UNPAID', 'PART_PAID', 'PAID', 'CANCELLED'] as const;
export type PlatformInvoiceStatus = (typeof PLATFORM_INVOICE_STATUSES)[number];
export const PLATFORM_PAYMENT_MODES = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER'] as const;
export type PlatformPaymentMode = (typeof PLATFORM_PAYMENT_MODES)[number];

/** Default grace period after an unpaid invoice's due date (owner, CD-126). */
export const DEFAULT_GRACE_DAYS = 30;
import { GSTIN_RE } from './accounts2';
const gstin = z.string().trim().toUpperCase().regex(GSTIN_RE, 'Enter a valid 15-character GSTIN').optional().nullable().or(z.literal('').transform(() => null));

// ───────────── S1 Billing settings (platform, super admin) ─────────────

export const billingSettingsSchema = z.object({
  graceDays: z.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days'),
  renewLeadDays: z.number().int().min(1, 'At least 1 day').max(60, 'At most 60 days'),
  gstRate: z.number().min(0).max(28).multipleOf(0.01),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/, '2–10 capital letters'),
  sellerName: z.string().trim().min(2, 'Enter the name').max(200),
  sellerAddress: z.string().trim().min(5, 'Enter the address').max(500),
  sellerState: z.string().trim().min(2, 'Enter the state').max(100),
  sellerGstin: gstin,
  sacCode: z.string().trim().regex(/^\d{4,8}$/, '4–8 digits').optional().nullable().or(z.literal('').transform(() => null)),
  bankName: optText(100),
  bankAccountName: optText(150),
  bankAccountNo: z.string().trim().regex(/^\d{6,20}$/, '6–20 digits').optional().nullable().or(z.literal('').transform(() => null)),
  bankIfsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC').optional().nullable().or(z.literal('').transform(() => null)),
  upiId: z.string().trim().regex(/^[\w.-]{2,}@[a-zA-Z]{2,}$/, 'Enter a valid UPI ID').optional().nullable().or(z.literal('').transform(() => null)),
});
export type BillingSettingsInput = z.infer<typeof billingSettingsSchema>;

/** Per-institution billing details (platform, super admin): own grace period, GSTIN, billing state. */
export const tenantBillingSchema = z.object({
  graceDays: z.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days').nullable(),
  gstin,
  billingState: optText(100),
});
export type TenantBillingInput = z.infer<typeof tenantBillingSchema>;

/** Monthly or yearly from the next renewal (institution administrator or platform). */
export const billingCycleSchema = z.object({ billingCycle: z.enum(BILLING_CYCLES) });
export type BillingCycleInput = z.infer<typeof billingCycleSchema>;

// ───────────── S3 / S4 Invoices and payments ─────────────

export const platformInvoiceQuery = z.object({
  status: z.enum([...PLATFORM_INVOICE_STATUSES, 'OVERDUE']).optional(),
  tenantId: z.string().uuid().optional(),
});

export const recordPlatformPaymentSchema = z.object({
  paidOn: date,
  amount: money,
  mode: z.enum(PLATFORM_PAYMENT_MODES),
  reference: optText(60),
  note: optText(200),
}).refine((v) => v.mode === 'CASH' || v.mode === 'OTHER' || !!v.reference, { message: 'Enter the UTR, UPI or cheque number', path: ['reference'] });
export type RecordPlatformPaymentInput = z.infer<typeof recordPlatformPaymentSchema>;

export const billingReasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });
export type BillingReasonInput = z.infer<typeof billingReasonSchema>;

// ───────────── Helpers (API and web) ─────────────

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Adds days to a YYYY-MM-DD date. */
export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Last day of a term that starts on `start`: one month or one year, less a day (31 Jan → 28/29 Feb − 1). */
export function termEnd(start: string, cycle: BillingCycle): string {
  const [y, m, d] = parts(start);
  const [ny, nm] = cycle === 'YEARLY' ? [y + 1, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
  return addDays(fmt(ny, nm, Math.min(d, daysIn(ny, nm))), -1);
}

/** Indian financial year of a date: 2026-27 for 1 Apr 2026 – 31 Mar 2027. */
export function financialYear(d: string): string {
  const [y, m] = parts(d);
  const s = m >= 4 ? y : y - 1;
  return `${s}-${pad((s + 1) % 100)}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** GST on a taxable amount: CGST + SGST (half each) within the seller's state, IGST otherwise. */
export function gstSplit(taxable: number, rate: number, sameState: boolean) {
  const tax = r2((taxable * rate) / 100);
  const cgst = sameState ? r2(tax / 2) : 0;
  const sgst = sameState ? r2(tax - cgst) : 0;
  const igst = sameState ? 0 : tax;
  return { cgst, sgst, igst, total: r2(taxable + tax) };
}

/** States compared loosely ("Karnataka", " karnataka "); GSTIN state codes win when both are known. */
export function sameGstState(sellerState: string, buyerState: string | null, sellerGstin?: string | null, buyerGstin?: string | null): boolean {
  if (sellerGstin && buyerGstin) return sellerGstin.slice(0, 2) === buyerGstin.slice(0, 2);
  if (!buyerState) return true;
  return sellerState.trim().toLowerCase() === buyerState.trim().toLowerCase();
}
