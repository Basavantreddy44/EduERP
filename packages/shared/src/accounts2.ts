import { z } from 'zod';
import { ACCOUNT_TYPES, StarterAccount } from './accounts';
import { money } from './fees';

/** Phase 13: full accounting (B4 §1) — set-up, vendors & bills, payments & vouchers, bank reconciliation, reports. */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const upper = (re: RegExp, msg: string) => z.string().trim().transform((v) => v.toUpperCase().replace(/\s/g, '')).pipe(z.string().regex(re, msg));
const posMoney = money.refine((v) => Number(v) > 0, 'Enter an amount above zero');

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const gstin = upper(GSTIN_RE, 'Enter a 15-character GSTIN, e.g. 29ABCDE1234F1Z5');
export const pan = upper(PAN_RE, 'Enter a 10-character PAN, e.g. ABCDE1234F');
export const ifsc = upper(IFSC_RE, 'Enter an 11-character IFSC, e.g. SBIN0001234');
const bankNo = z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{6,18}$/, 'Enter the account number (6 to 18 digits)'));
/** Two-digit GST state code (Karnataka = 29). */
export const stateCode = z.string().trim().regex(/^\d{2}$/, 'Two-digit state code, e.g. 29 for Karnataka');
export const HOME_STATE_CODE = '29';

/** The PAN's 4th letter tells the holder type: P / H (individual, HUF) use the individual TDS rate. */
export const panHolder = (p: string | null | undefined): 'INDIVIDUAL' | 'OTHER' | 'NONE' => (!p ? 'NONE' : ['P', 'H'].includes(p[3]) ? 'INDIVIDUAL' : 'OTHER');

/** Accounts the accounts module adds to the starter chart (system keys; idempotent). */
export const ACCOUNTS_CHART: StarterAccount[] = [
  { key: 'PETTY_CASH', code: '1110', name: 'Petty cash', type: 'ASSET', parent: 'ASSETS' },
  { key: 'BANK_ACCOUNTS', code: '1250', name: 'Bank accounts', type: 'ASSET', group: true, parent: 'ASSETS' },
  { key: 'VENDOR_ADVANCES', code: '1500', name: 'Advances to vendors', type: 'ASSET', parent: 'ASSETS' },
  { key: 'INPUT_GST', code: '1600', name: 'Input GST (claimable)', type: 'ASSET', group: true, parent: 'ASSETS' },
  { key: 'INPUT_CGST', code: '1610', name: 'Input CGST', type: 'ASSET', parent: 'INPUT_GST' },
  { key: 'INPUT_SGST', code: '1620', name: 'Input SGST', type: 'ASSET', parent: 'INPUT_GST' },
  { key: 'INPUT_IGST', code: '1630', name: 'Input IGST', type: 'ASSET', parent: 'INPUT_GST' },
  { key: 'VENDORS_PAYABLE', code: '2300', name: 'Sundry creditors (vendors)', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'TDS_PAYABLE', code: '2400', name: 'TDS payable', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'SURPLUS', code: '3200', name: 'Accumulated surplus', type: 'EQUITY', parent: 'EQUITY' },
  { key: 'OPENING_DIFF', code: '3900', name: 'Opening balance difference', type: 'EQUITY', parent: 'EQUITY' },
  { key: 'INCOME_INTEREST', code: '4200', name: 'Bank interest', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_DONATIONS', code: '4300', name: 'Donations & grants', type: 'INCOME', parent: 'INCOME' },
  { key: 'EXP_SALARY', code: '5300', name: 'Salaries & wages', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_RENT', code: '5400', name: 'Rent', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_UTILITIES', code: '5410', name: 'Electricity & water', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_REPAIRS', code: '5420', name: 'Repairs & maintenance', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_STATIONERY', code: '5430', name: 'Printing & stationery', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_TEACHING', code: '5440', name: 'Teaching & lab materials', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_TRANSPORT', code: '5450', name: 'Vehicle fuel & upkeep', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_COMMUNICATION', code: '5460', name: 'Telephone & internet', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_PROFESSIONAL', code: '5470', name: 'Professional & audit fees', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_EVENTS', code: '5480', name: 'Events & functions', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_MISC', code: '5490', name: 'Miscellaneous expenses', type: 'EXPENSE', parent: 'EXPENSES' },
];

/**
 * Starting GST codes (CD-85) — the rates commonly used from 22 Sep 2025 (5% and 18%, 40% for a few goods).
 * Education services are mostly exempt, so input GST is usually NOT claimable: it is added to the cost.
 * Schools must have their accountant confirm these.
 */
export const STARTER_TAX_CODES = [
  { code: 'EXEMPT', name: 'Exempt / nil-rated', ratePercent: '0.00', itcClaimable: false, effectiveFrom: '2017-07-01' },
  { code: 'GST5', name: 'GST 5%', ratePercent: '5.00', itcClaimable: false, effectiveFrom: '2025-09-22' },
  { code: 'GST18', name: 'GST 18%', ratePercent: '18.00', itcClaimable: false, effectiveFrom: '2025-09-22' },
  { code: 'GST40', name: 'GST 40%', ratePercent: '40.00', itcClaimable: false, effectiveFrom: '2025-09-22' },
] as const;

/**
 * Starting TDS sections (CD-85), with rates and thresholds commonly used for 2025-26. From 1 Apr 2026 the
 * Income-tax Act 2025 renumbers these (TDS in section 393); the familiar codes are kept as labels.
 * Without a PAN the higher no-PAN rate applies. Schools must have their accountant confirm these.
 */
export const STARTER_TDS_SECTIONS = [
  { sectionCode: '194C', description: 'Payments to contractors (works, transport, catering, housekeeping)', rateIndividual: '1.00', rateOthers: '2.00', rateNoPan: '20.00', thresholdSingle: '30000.00', thresholdAnnual: '100000.00', effectiveFrom: '2025-04-01' },
  { sectionCode: '194J', description: 'Professional fees (auditors, consultants, doctors)', rateIndividual: '10.00', rateOthers: '10.00', rateNoPan: '20.00', thresholdSingle: null, thresholdAnnual: '50000.00', effectiveFrom: '2025-04-01' },
  { sectionCode: '194J-T', description: 'Fees for technical services', rateIndividual: '2.00', rateOthers: '2.00', rateNoPan: '20.00', thresholdSingle: null, thresholdAnnual: '50000.00', effectiveFrom: '2025-04-01' },
  { sectionCode: '194I', description: 'Rent of land or buildings', rateIndividual: '10.00', rateOthers: '10.00', rateNoPan: '20.00', thresholdSingle: '50000.00', thresholdAnnual: null, effectiveFrom: '2025-04-01' },
  { sectionCode: '194H', description: 'Commission or brokerage', rateIndividual: '2.00', rateOthers: '2.00', rateNoPan: '20.00', thresholdSingle: null, thresholdAnnual: '20000.00', effectiveFrom: '2025-04-01' },
] as const;

// ───────────── M13.1 Set-up ─────────────

export const accountSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Z-]{2,20}$/i, 'Code: 2–20 letters, digits or dashes'),
  name: z.string().trim().min(2).max(150),
  accountType: z.enum(ACCOUNT_TYPES),
  parentId: uuid,
  isGroup: z.boolean().default(false),
});
export type AccountInput = z.infer<typeof accountSchema>;
export const accountUpdateSchema = z.object({ name: z.string().trim().min(2).max(150), isActive: z.boolean() });

export const costCentreSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Z-]{2,20}$/i, 'Code: 2–20 letters, digits or dashes'),
  name: z.string().trim().min(2).max(100),
  campusId: uuid.optional().nullable(),
  departmentId: uuid.optional().nullable(),
  isActive: z.boolean().default(true),
});
export type CostCentreInput = z.infer<typeof costCentreSchema>;

export const BANK_ACCOUNT_TYPES = ['CURRENT', 'SAVINGS', 'OD'] as const;
export const bankAccountSchema = z.object({
  campusId: uuid.optional().nullable(),
  bankName: z.string().trim().min(2).max(100),
  branch: optText(100),
  accountNo: bankNo,
  ifsc,
  accountType: z.enum(BANK_ACCOUNT_TYPES),
  isFeeCollection: z.boolean().default(false),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export const taxCodeSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Z-]{2,20}$/i, 'Code: 2–20 letters, digits or dashes'),
  name: z.string().trim().min(2).max(100),
  ratePercent: money.refine((v) => Number(v) <= 100, 'At most 100%'),
  itcClaimable: z.boolean().default(false),
  effectiveFrom: date,
  effectiveTo: date.optional().nullable(),
}).refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: 'Ends before it starts', path: ['effectiveTo'] });
export type TaxCodeInput = z.infer<typeof taxCodeSchema>;

const pct = money.refine((v) => Number(v) <= 100, 'At most 100%');
export const tdsSectionSchema = z.object({
  sectionCode: z.string().trim().min(2).max(10),
  description: z.string().trim().min(3).max(200),
  rateIndividual: pct,
  rateOthers: pct,
  rateNoPan: pct,
  thresholdSingle: money.optional().nullable(),
  thresholdAnnual: money.optional().nullable(),
  effectiveFrom: date,
  effectiveTo: date.optional().nullable(),
});
export type TdsSectionInput = z.infer<typeof tdsSectionSchema>;

const twoSided = z.object({ accountId: uuid, costCentreId: uuid.optional().nullable(), debit: money.default('0'), credit: money.default('0') })
  .refine((l) => (Number(l.debit) > 0) !== (Number(l.credit) > 0), { message: 'Enter either a debit or a credit', path: ['debit'] });
const balanced = <T extends { lines: { debit: string; credit: string }[] }>(v: T) => {
  const d = v.lines.reduce((a, l) => a + Math.round(Number(l.debit) * 100), 0);
  const c = v.lines.reduce((a, l) => a + Math.round(Number(l.credit) * 100), 0);
  return d === c && d > 0;
};
export const openingBalancesSchema = z.object({
  asOn: date,
  lines: z.array(twoSided).min(2).max(500),
}).refine(balanced, { message: 'Total debits must equal total credits', path: ['lines'] });
export type OpeningBalancesInput = z.infer<typeof openingBalancesSchema>;

/** A calendar month "2026-11". */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month like 2026-11');
export const periodLockSchema = z.object({ month: monthSchema });
export const periodUnlockSchema = z.object({ month: monthSchema, reason: z.string().trim().min(5).max(300) });
export const yearCloseSchema = z.object({ financialYearId: uuid });

// ───────────── M13.2 Vendors & bills ─────────────

export const VENDOR_TYPES = ['SUPPLIER', 'SERVICE', 'CONTRACTOR', 'UTILITY', 'LANDLORD', 'PROFESSIONAL'] as const;
export const vendorSchema = z.object({
  name: z.string().trim().min(2).max(200),
  vendorType: z.enum(VENDOR_TYPES),
  gstin: gstin.optional().nullable().or(z.literal('').transform(() => null)),
  pan: pan.optional().nullable().or(z.literal('').transform(() => null)),
  stateCode: stateCode.default(HOME_STATE_CODE),
  phone: z.string().trim().regex(/^\d{6,15}$/, 'Phone: 6 to 15 digits').optional().nullable().or(z.literal('').transform(() => null)),
  email: z.string().trim().email().max(150).optional().nullable().or(z.literal('').transform(() => null)),
  address: optText(500),
  bankName: optText(100),
  bankAccountNo: bankNo.optional().nullable().or(z.literal('').transform(() => null)),
  ifsc: ifsc.optional().nullable().or(z.literal('').transform(() => null)),
  tdsSectionId: uuid.optional().nullable(),
  status: z.enum(['ACTIVE', 'BLOCKED']).default('ACTIVE'),
}).refine((v) => !v.gstin || !v.pan || v.gstin.slice(2, 12) === v.pan, { message: 'The PAN does not match the GSTIN (characters 3–12)', path: ['pan'] })
  .refine((v) => !v.gstin || v.gstin.slice(0, 2) === v.stateCode, { message: 'The state code does not match the GSTIN', path: ['stateCode'] })
  .refine((v) => !v.bankAccountNo || !!v.ifsc, { message: 'Enter the IFSC with the account number', path: ['ifsc'] });
export type VendorInput = z.infer<typeof vendorSchema>;

export const billItemSchema = z.object({
  accountId: uuid,
  costCentreId: uuid.optional().nullable(),
  description: z.string().trim().min(2).max(300),
  quantity: money.refine((v) => Number(v) > 0, 'Quantity above zero').default('1'),
  rate: posMoney,
  taxCodeId: uuid.optional().nullable(),
});
export const billSchema = z.object({
  campusId: uuid,
  vendorId: uuid,
  billNo: z.string().trim().min(1).max(50),
  billDate: date,
  dueDate: date.optional().nullable(),
  items: z.array(billItemSchema).min(1).max(100),
  applyTds: z.boolean().default(true),
  notes: optText(500),
}).refine((v) => !v.dueDate || v.dueDate >= v.billDate, { message: 'Due before the bill date', path: ['dueDate'] });
export type BillInput = z.infer<typeof billSchema>;

// ───────────── M13.3 Payments & vouchers ─────────────

export const VENDOR_PAYMENT_MODES = ['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'] as const;
export const vendorPaymentSchema = z.object({
  campusId: uuid,
  vendorId: uuid,
  paymentDate: date,
  mode: z.enum(VENDOR_PAYMENT_MODES),
  bankAccountId: uuid.optional().nullable(),
  referenceNo: optText(50),
  allocations: z.array(z.object({ billId: uuid, amount: posMoney })).max(100).default([]),
  advanceAmount: money.default('0'),
  narration: optText(300),
}).refine((v) => v.mode === 'CASH' || !!v.bankAccountId, { message: 'Choose the bank account', path: ['bankAccountId'] })
  .refine((v) => v.mode === 'CASH' || !!v.referenceNo, { message: 'Enter the cheque / UTR number', path: ['referenceNo'] })
  .refine((v) => v.allocations.length > 0 || Number(v.advanceAmount) > 0, { message: 'Choose bills to pay or enter an advance', path: ['allocations'] })
  .refine((v) => new Set(v.allocations.map((a) => a.billId)).size === v.allocations.length, { message: 'A bill is listed twice', path: ['allocations'] });
export type VendorPaymentInput = z.infer<typeof vendorPaymentSchema>;

export const expenseVoucherSchema = z.object({
  campusId: uuid,
  voucherDate: date,
  expenseAccountId: uuid,
  paidFromAccountId: uuid,
  costCentreId: uuid.optional().nullable(),
  amount: posMoney,
  paidTo: z.string().trim().min(2).max(150),
  narration: z.string().trim().min(3).max(500),
});
export type ExpenseVoucherInput = z.infer<typeof expenseVoucherSchema>;

export const contraSchema = z.object({
  campusId: uuid.optional().nullable(),
  voucherDate: date,
  fromAccountId: uuid,
  toAccountId: uuid,
  amount: posMoney,
  referenceNo: optText(50),
  narration: z.string().trim().min(3).max(500),
}).refine((v) => v.fromAccountId !== v.toAccountId, { message: 'Choose two different accounts', path: ['toAccountId'] });
export type ContraInput = z.infer<typeof contraSchema>;

export const journalVoucherSchema = z.object({
  campusId: uuid.optional().nullable(),
  voucherDate: date,
  narration: z.string().trim().min(3).max(500),
  lines: z.array(twoSided).min(2).max(100),
}).refine(balanced, { message: 'Total debits must equal total credits', path: ['lines'] });
export type JournalVoucherInput = z.infer<typeof journalVoucherSchema>;

export const cancelSchema = z.object({ reason: z.string().trim().min(5).max(300), date: date.optional() });

// ───────────── M13.4 Bank reconciliation ─────────────

export const DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YY', 'DD-MMM-YYYY'] as const;
export const statementMappingSchema = z.object({
  bankAccountId: uuid,
  dateColumn: z.string().min(1).max(60),
  descriptionColumn: z.string().min(1).max(60),
  referenceColumn: z.string().max(60).optional().nullable(),
  debitColumn: z.string().min(1).max(60),
  creditColumn: z.string().min(1).max(60),
  balanceColumn: z.string().max(60).optional().nullable(),
  dateFormat: z.enum(DATE_FORMATS),
});
export type StatementMapping = z.infer<typeof statementMappingSchema>;
export const matchSchema = z.object({ statementLineId: uuid, journalLineIds: z.array(uuid).min(1).max(20) });
export const ignoreLineSchema = z.object({ reason: z.string().trim().min(3).max(200) });
export const postLineSchema = z.object({ accountId: uuid, narration: z.string().trim().min(3).max(300) });

// ───────────── M13.5 Reports ─────────────

export const REPORTS = ['DAY_BOOK', 'CASH_BOOK', 'BANK_BOOK', 'LEDGER', 'TRIAL_BALANCE', 'INCOME_EXPENDITURE', 'BALANCE_SHEET', 'RECEIPTS_PAYMENTS', 'GST_REGISTER', 'TDS_REGISTER'] as const;
export type ReportCode = (typeof REPORTS)[number];
export const accountsReportQuerySchema = z.object({
  from: date,
  to: date,
  campusId: uuid.optional(),
  accountId: uuid.optional(),
  costCentreId: uuid.optional(),
}).refine((v) => v.to >= v.from, { message: 'Ends before it starts', path: ['to'] });
export type AccountsReportQuery = z.infer<typeof accountsReportQuerySchema>;
