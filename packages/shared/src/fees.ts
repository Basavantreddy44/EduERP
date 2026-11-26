import { z } from 'zod';

/**
 * Fees (B1 Phase 2). Money travels as a decimal string with at most 2 decimals ("12500.00") and is
 * calculated in paise (integers) — never with floating point.
 */

/** Rupees → paise. Accepts "12,500.5", 12500.5 or "12500". */
export function toPaise(v: string | number): number {
  const s = String(v).replace(/,/g, '').trim();
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(s)) throw new Error(`Not an amount: ${v}`);
  const neg = s.startsWith('-');
  const [r, p = ''] = s.replace('-', '').split('.');
  const paise = Number(r) * 100 + Number(p.padEnd(2, '0'));
  return neg ? -paise : paise;
}
/** Paise → "12500.50". */
export const fromPaise = (p: number) => `${p < 0 ? '-' : ''}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, '0')}`;
/** Paise → "₹12,500.50" (Indian grouping); whole rupees drop the ".00". */
export function formatINR(p: number, opts: { paise?: boolean } = {}) {
  const r = Math.abs(p) / 100;
  const s = r.toLocaleString('en-IN', { minimumFractionDigits: opts.paise || p % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${p < 0 ? '−' : ''}₹${s}`;
}

/** Amount field: non-negative, up to 2 decimals, up to ₹99,99,99,99,999. Output: "1234.50". */
export const money = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const p = toPaise(v);
      if (p < 0) throw new Error('negative');
      return fromPaise(p);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount in rupees, e.g. 12500 or 12500.50' });
      return z.NEVER;
    }
  });

// ───────────── Fee heads ─────────────

export const FEE_TYPES = ['ACADEMIC', 'ADMISSION', 'EXAM', 'TRANSPORT', 'HOSTEL', 'MESS', 'DEPOSIT', 'FINE', 'OTHER'] as const;
export type FeeType = (typeof FEE_TYPES)[number];

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, '2–20 letters, digits, - or _');

export const createFeeHeadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code,
  feeType: z.enum(FEE_TYPES),
  /** Income (or deposit liability) account; default chosen from the fee type when omitted. */
  incomeAccountId: z.string().uuid().optional().nullable(),
  isRefundable: z.boolean().default(false),
  gstApplicable: z.boolean().default(false),
});
export type CreateFeeHeadInput = z.infer<typeof createFeeHeadSchema>;
export const updateFeeHeadSchema = createFeeHeadSchema.omit({ code: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export type UpdateFeeHeadInput = z.infer<typeof updateFeeHeadSchema>;

// ───────────── Fee structures ─────────────

export const FEE_STRUCTURE_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export const MAX_INSTALMENTS = 12;

const instalment = z.object({
  instalmentNo: z.number().int().min(1).max(MAX_INSTALMENTS),
  name: z.string().trim().min(1).max(50),
  dueDate: z.string().date(),
});
const item = z.object({
  feeHeadId: z.string().uuid(),
  instalmentNo: z.number().int().min(1).max(MAX_INSTALMENTS),
  amount: money,
});

/**
 * A structure: one class, one academic year, optionally one fee group (e.g. "New admission",
 * "Management quota"), instalments with due dates, and amounts per fee head per instalment.
 */
export const feeStructureSchema = z
  .object({
    campusId: z.string().uuid(),
    academicYearId: z.string().uuid(),
    programLevelId: z.string().uuid(),
    name: z.string().trim().min(2).max(150),
    feeGroup: z.string().trim().max(30).optional().nullable(),
    instalments: z.array(instalment).min(1).max(MAX_INSTALMENTS),
    items: z.array(item).max(400),
  })
  .superRefine((v, ctx) => {
    const nos = v.instalments.map((i) => i.instalmentNo);
    if (new Set(nos).size !== nos.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instalments'], message: 'Instalment numbers must be different' });
    const sorted = [...v.instalments].sort((a, b) => a.instalmentNo - b.instalmentNo);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].dueDate < sorted[i - 1].dueDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instalments', i, 'dueDate'], message: 'Due dates must follow the instalment order' });
    }
    const keys = new Set<string>();
    v.items.forEach((it, i) => {
      if (!nos.includes(it.instalmentNo)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'instalmentNo'], message: 'No such instalment' });
      const k = `${it.feeHeadId}|${it.instalmentNo}`;
      if (keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i], message: 'The same fee head appears twice in one instalment' });
      keys.add(k);
    });
  });
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;
export const updateFeeStructureSchema = feeStructureSchema.innerType().omit({ campusId: true, academicYearId: true, programLevelId: true });
export type UpdateFeeStructureInput = z.infer<typeof updateFeeStructureSchema>;

export const copyFeeStructureSchema = z.object({
  /** Target academic year; due dates move by the same number of years. */
  academicYearId: z.string().uuid(),
  /** Classes to copy to (same programme); default: the same class. */
  programLevelIds: z.array(z.string().uuid()).max(30).optional(),
});
export type CopyFeeStructureInput = z.infer<typeof copyFeeStructureSchema>;

export const feeStructureQuerySchema = z.object({
  campusId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  programLevelId: z.string().uuid().optional(),
  status: z.enum(FEE_STRUCTURE_STATUSES).optional(),
});

// ───────────── Late fee ─────────────

export const FINE_TYPES = ['FIXED', 'PER_DAY', 'PERCENT'] as const;
export const lateFeeRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    campusId: z.string().uuid().optional().nullable(),
    feeHeadId: z.string().uuid().optional().nullable(),
    graceDays: z.number().int().min(0).max(365),
    fineType: z.enum(FINE_TYPES),
    fineValue: money,
    maxFine: money.optional().nullable(),
  })
  .refine((v) => v.fineType !== 'PERCENT' || toPaise(v.fineValue) <= 10_000, { message: 'A percentage cannot be more than 100', path: ['fineValue'] })
  .refine((v) => toPaise(v.fineValue) > 0, { message: 'Enter the fine', path: ['fineValue'] });
export type LateFeeRuleInput = z.infer<typeof lateFeeRuleSchema>;

/**
 * Late fee for one overdue amount (all in paise). FIXED: once after the grace period. PER_DAY: for
 * each day past due + grace. PERCENT: of the overdue amount (fineValue holds the percent ×100 paise
 * scale, i.e. "2.50" = 2.5 %). The cap applies to every type.
 */
export function lateFee(rule: { graceDays: number; fineType: (typeof FINE_TYPES)[number]; fineValuePaise: number; maxFinePaise: number | null }, overduePaise: number, daysLate: number) {
  if (overduePaise <= 0 || daysLate <= rule.graceDays) return 0;
  let fine =
    rule.fineType === 'FIXED' ? rule.fineValuePaise
      : rule.fineType === 'PER_DAY' ? rule.fineValuePaise * (daysLate - rule.graceDays)
        : Math.round((overduePaise * rule.fineValuePaise) / 10_000);
  if (rule.maxFinePaise !== null) fine = Math.min(fine, rule.maxFinePaise);
  return fine;
}

// ───────────── Billing (M2.2) ─────────────

export const INVOICE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const billingRunSchema = z.object({
  academicYearId: z.string().uuid(),
  instalmentNo: z.number().int().min(1).max(MAX_INSTALMENTS),
  campusId: z.string().uuid().optional().nullable(),
  programLevelId: z.string().uuid().optional().nullable(),
  /** Bill date (default today). The due date comes from the structure's instalment. */
  invoiceDate: z.string().date().optional().nullable(),
});
export type BillingRunInput = z.infer<typeof billingRunSchema>;

export const assignStructureSchema = z.object({ feeStructureId: z.string().uuid() });

export const extraChargeSchema = z.object({
  feeHeadId: z.string().uuid(),
  amount: money.refine((v) => toPaise(v) > 0, 'Enter the amount'),
  dueDate: z.string().date(),
  description: z.string().trim().min(3).max(200),
});
export type ExtraChargeInput = z.infer<typeof extraChargeSchema>;

export const cancelInvoiceSchema = z.object({ reason: z.string().trim().min(5).max(300) });

// ───────────── Concessions ─────────────

export const CONCESSION_TYPES = ['SIBLING', 'MERIT', 'STAFF_CHILD', 'SCHOLARSHIP', 'MANAGEMENT', 'OTHER'] as const;
export const CONCESSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

/**
 * A concession for one student and year: a percentage of each matching bill line, or a fixed amount
 * for the whole year used up bill by bill. NULL fee head = all heads.
 */
export const concessionSchema = z
  .object({
    academicYearId: z.string().uuid(),
    feeHeadId: z.string().uuid().optional().nullable(),
    concessionType: z.enum(CONCESSION_TYPES),
    valueType: z.enum(['PERCENT', 'AMOUNT']),
    value: money,
    reason: z.string().trim().min(5).max(300),
  })
  .refine((v) => toPaise(v.value) > 0, { message: 'Enter the concession', path: ['value'] })
  .refine((v) => v.valueType !== 'PERCENT' || toPaise(v.value) <= 10_000, { message: 'A percentage cannot be more than 100', path: ['value'] });
export type ConcessionInput = z.infer<typeof concessionSchema>;

export interface ConcessionRule { id: string; feeHeadId: string | null; valueType: 'PERCENT' | 'AMOUNT'; valuePaise: number; usedPaise: number }
export interface BillLine { feeHeadId: string; amountPaise: number }

/**
 * Concession per bill line (paise). Percentages apply to each matching line; fixed amounts are used
 * up in line order until their remaining balance is gone. A line never gets more concession than
 * its amount. Returns per line the total and the share of each concession (for tracking usage).
 */
export function applyConcessions(lines: BillLine[], rules: ConcessionRule[]) {
  const remaining = new Map(rules.map((r) => [r.id, Math.max(0, r.valuePaise - r.usedPaise)]));
  return lines.map((l) => {
    let left = l.amountPaise;
    const parts: { concessionId: string; amountPaise: number }[] = [];
    for (const r of rules) {
      if (left <= 0) break;
      if (r.feeHeadId && r.feeHeadId !== l.feeHeadId) continue;
      let c = r.valueType === 'PERCENT' ? Math.round((l.amountPaise * r.valuePaise) / 10_000) : remaining.get(r.id)!;
      c = Math.min(c, left);
      if (c <= 0) continue;
      if (r.valueType === 'AMOUNT') remaining.set(r.id, remaining.get(r.id)! - c);
      parts.push({ concessionId: r.id, amountPaise: c });
      left -= c;
    }
    return { ...l, concessionPaise: l.amountPaise - left, parts };
  });
}

// ───────────── Collection (M2.3) ─────────────

/** Modes a cashier records at the counter. ONLINE payments come only through the payment gateway. */
export const PAYMENT_MODES = ['CASH', 'CHEQUE', 'DD', 'UPI', 'CARD', 'BANK_TRANSFER'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const ALL_PAYMENT_MODES = [...PAYMENT_MODES, 'ONLINE'] as const;
export const PAYMENT_STATUSES = ['SUCCESS', 'CANCELLED', 'BOUNCED'] as const;
/** Modes that need a reference (cheque / DD number, UPI or bank transaction id). */
export const MODES_WITH_REFERENCE: PaymentMode[] = ['CHEQUE', 'DD', 'UPI', 'CARD', 'BANK_TRANSFER'];

export const openCounterSchema = z.object({ campusId: z.string().uuid(), openingCash: money });
export const closeCounterSchema = z.object({ countedCash: money, remarks: z.string().trim().max(300).optional().nullable() });

export const collectSchema = z
  .object({
    studentId: z.string().uuid(),
    amount: money.refine((v) => toPaise(v) > 0, 'Enter the amount received'),
    mode: z.enum(PAYMENT_MODES),
    paymentDate: z.string().date().optional().nullable(),
    payerName: z.string().trim().min(2).max(150),
    referenceNo: z.string().trim().max(100).optional().nullable(),
    chequeDate: z.string().date().optional().nullable(),
    bankName: z.string().trim().max(100).optional().nullable(),
    notes: z.string().trim().max(300).optional().nullable(),
    /** Bills to pay, in order; default: oldest due first. Each gets up to its balance. */
    invoiceIds: z.array(z.string().uuid()).max(50).optional(),
    /** Phase 23: money over the chosen bills (or over everything due) is kept as the student's credit. */
    keepCredit: z.boolean().optional(),
  })
  .refine((v) => !MODES_WITH_REFERENCE.includes(v.mode) || !!v.referenceNo, { message: 'Enter the cheque / DD / transaction number', path: ['referenceNo'] })
  .refine((v) => !['CHEQUE', 'DD'].includes(v.mode) || !!v.bankName, { message: 'Enter the bank', path: ['bankName'] });
export type CollectInput = z.infer<typeof collectSchema>;

export const cancelReceiptSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export const bounceSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  /** Optional bounce charge billed to the student. */
  chargeAmount: money.optional().nullable(),
  chargeFeeHeadId: z.string().uuid().optional().nullable(),
}).refine((v) => !v.chargeAmount || toPaise(v.chargeAmount) === 0 || !!v.chargeFeeHeadId, { message: 'Choose the fee head for the charge', path: ['chargeFeeHeadId'] });
export type BounceInput = z.infer<typeof bounceSchema>;

/**
 * Splits a payment over bill lines, oldest first (paise). Lines are paid in the order given; the
 * payment never exceeds what is due. Returns the allocations and anything left over.
 */
export function allocate(amountPaise: number, lines: { id: string; duePaise: number }[]) {
  let left = amountPaise;
  const out: { id: string; amountPaise: number }[] = [];
  for (const l of lines) {
    if (left <= 0) break;
    const a = Math.min(left, l.duePaise);
    if (a > 0) out.push({ id: l.id, amountPaise: a });
    left -= a;
  }
  return { allocations: out, leftPaise: left };
}

/** Rupees in words, Indian style: 125050 → "One lakh twenty-five thousand and fifty rupees". */
export function rupeesInWords(paise: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? `-${ones[n % 10]}` : ''}`);
  const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${two(n % 100)}` : ''}` : two(n));
  const words = (n: number): string => {
    if (n === 0) return 'zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(`${words(crore)} crore`);
    if (lakh) parts.push(`${two(lakh)} lakh`);
    if (thousand) parts.push(`${two(thousand)} thousand`);
    if (n) parts.push(parts.length && n < 100 ? `and ${two(n)}` : three(n));
    return parts.join(' ');
  };
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  const s = `${words(r)} rupee${r === 1 ? '' : 's'}${p ? ` and ${two(p)} paise` : ''} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ───────────── Online payment & refunds (M2.4) ─────────────

export const createPayLinkSchema = z.object({
  studentId: z.string().uuid(),
  /** Bills the link pays (default: all open bills). */
  invoiceIds: z.array(z.string().uuid()).max(50).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  /** Email the link to the student's main contact (if they have an email). */
  sendEmail: z.boolean().default(false),
});
export type CreatePayLinkInput = z.infer<typeof createPayLinkSchema>;

export const confirmOnlineSchema = z.object({
  orderId: z.string().trim().min(5).max(60),
  paymentId: z.string().trim().min(5).max(60),
  signature: z.string().trim().regex(/^[a-f0-9]{64}$/, 'Invalid signature'),
});
export const simulatePaySchema = z.object({ orderId: z.string().trim().min(5).max(60), outcome: z.enum(['success', 'failure']) });

export const REFUND_STATUSES = ['PENDING', 'PAID', 'REJECTED', 'FAILED', 'CANCELLED'] as const;
export const requestRefundSchema = z.object({
  amount: money.refine((v) => toPaise(v) > 0, 'Enter the amount to refund'),
  reason: z.string().trim().min(5).max(300),
  /** How money goes back for non-online receipts (online refunds always go back through the gateway). */
  refundMode: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE']).optional().nullable(),
});
export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

/** Razorpay-style signatures: HMAC-SHA256 hex. Checkout: "orderId|paymentId" with the key secret. */
export const checkoutPayload = (orderId: string, paymentId: string) => `${orderId}|${paymentId}`;

// ───────────── Dues, late fees, reminders, reports (M2.5) ─────────────

export const AGEING_BUCKETS = ['NOT_DUE', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
/** Ageing bucket of an amount due on `dueDate`, seen on `today` (both YYYY-MM-DD). */
export function ageingBucket(dueDate: string, today: string): AgeingBucket {
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? 'NOT_DUE' : days <= 30 ? 'D1_30' : days <= 60 ? 'D31_60' : days <= 90 ? 'D61_90' : 'D90_PLUS';
}

export const DUES_SORTS = ['balance', 'overdue', 'name', 'class', 'oldest'] as const;
export const duesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  campusId: z.string().uuid().optional(),
  programLevelId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  /** Only students with something overdue for at least this many days. */
  minDaysOverdue: z.coerce.number().int().min(0).max(3650).optional(),
  minBalance: money.optional(),
  /** Phase 23: only students with dues from an earlier academic year (or opening dues). */
  earlier: z.enum(['only']).optional(),
  sort: z.enum(DUES_SORTS).default('overdue'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type DuesQuery = z.infer<typeof duesQuerySchema>;

export const remindSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1).max(500),
  /** Add a payment link (when online payment is available) so the parent can pay from the email. */
  includePayLink: z.boolean().default(true),
});
export type RemindInput = z.infer<typeof remindSchema>;

export const waiveFineSchema = z.object({ reason: z.string().trim().min(5).max(300) });

export const reportQuerySchema = z
  .object({ from: z.string().date(), to: z.string().date(), campusId: z.string().uuid().optional() })
  .refine((v) => v.from <= v.to, { message: 'The start date must be before the end date', path: ['from'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000, { message: 'Choose at most one year', path: ['to'] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

// ───────────── Fees at go-live (Phase 23) ─────────────

/** "2024-25": a real academic-year label (the second part is the next year). */
export const isYearLabel = (v: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
};

/** Use part of a student's credit balance against one bill. */
export const adjustCreditSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: money.refine((v) => toPaise(v) > 0, 'Enter the amount to use'),
  note: z.string().trim().max(300).optional().nullable(),
});
export type AdjustCreditInput = z.infer<typeof adjustCreditSchema>;

export const cancelAdjustmentSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300) });

/** Pay a student's credit balance back (through the refund approval). */
export const creditRefundSchema = z.object({
  amount: money.refine((v) => toPaise(v) > 0, 'Enter the amount to refund'),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300),
  refundMode: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE']),
});
export type CreditRefundInput = z.infer<typeof creditRefundSchema>;

export const carriedDuesQuery = z.object({ campusId: z.string().uuid().optional(), programLevelId: z.string().uuid().optional() });
export type CarriedDuesQuery = z.infer<typeof carriedDuesQuery>;
