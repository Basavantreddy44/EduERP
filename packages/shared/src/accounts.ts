import type { FeeType } from './fees';

/**
 * Basic accounts (B1 §11). Each institution gets a small starter chart of accounts the first time
 * fees are set up. System accounts are found by `systemKey`, never by name or code, so a school may
 * rename or renumber them. Full accounting screens come in B4.
 */
export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface StarterAccount { key: string; code: string; name: string; type: AccountType; group?: boolean; parent?: string }

export const STARTER_CHART: StarterAccount[] = [
  { key: 'ASSETS', code: '1000', name: 'Assets', type: 'ASSET', group: true },
  { key: 'CASH', code: '1100', name: 'Cash in hand', type: 'ASSET', parent: 'ASSETS' },
  { key: 'BANK', code: '1200', name: 'Bank account', type: 'ASSET', parent: 'ASSETS' },
  { key: 'GATEWAY_CLEARING', code: '1300', name: 'Online payments clearing', type: 'ASSET', parent: 'ASSETS' },
  { key: 'CHEQUES_IN_HAND', code: '1310', name: 'Cheques / DD in hand', type: 'ASSET', parent: 'ASSETS' },
  { key: 'STUDENT_RECEIVABLE', code: '1400', name: 'Student fees receivable', type: 'ASSET', parent: 'ASSETS' },
  { key: 'LIABILITIES', code: '2000', name: 'Liabilities', type: 'LIABILITY', group: true },
  { key: 'FEE_ADVANCE', code: '2100', name: 'Fees received in advance', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'DEPOSITS', code: '2200', name: 'Refundable deposits', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'EQUITY', code: '3000', name: 'Funds', type: 'EQUITY', group: true },
  { key: 'CAPITAL_FUND', code: '3100', name: 'General fund', type: 'EQUITY', parent: 'EQUITY' },
  { key: 'INCOME', code: '4000', name: 'Income', type: 'INCOME', group: true },
  { key: 'INCOME_ACADEMIC', code: '4100', name: 'Tuition & academic fees', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_ADMISSION', code: '4110', name: 'Admission fees', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_EXAM', code: '4120', name: 'Examination fees', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_TRANSPORT', code: '4130', name: 'Transport fees', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_HOSTEL', code: '4140', name: 'Hostel & mess fees', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_FINE', code: '4150', name: 'Fines & late fees', type: 'INCOME', parent: 'INCOME' },
  { key: 'INCOME_OTHER', code: '4190', name: 'Other fee income', type: 'INCOME', parent: 'INCOME' },
  { key: 'EXPENSES', code: '5000', name: 'Expenses', type: 'EXPENSE', group: true },
  { key: 'CONCESSIONS', code: '5100', name: 'Fee concessions & scholarships', type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'BANK_CHARGES', code: '5200', name: 'Bank & gateway charges', type: 'EXPENSE', parent: 'EXPENSES' },
];

/** Where a fee head posts by default, from its type. */
export const DEFAULT_INCOME_ACCOUNT: Record<FeeType, string> = {
  ACADEMIC: 'INCOME_ACADEMIC', ADMISSION: 'INCOME_ADMISSION', EXAM: 'INCOME_EXAM', TRANSPORT: 'INCOME_TRANSPORT',
  HOSTEL: 'INCOME_HOSTEL', MESS: 'INCOME_HOSTEL', DEPOSIT: 'DEPOSITS', FINE: 'INCOME_FINE', OTHER: 'INCOME_OTHER',
};

/** Indian financial year (April–March) that contains a date: "2026-27". */
export function financialYearOf(isoDate: string) {
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { name: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, startDate: `${start}-04-01`, endDate: `${start + 1}-03-31` };
}
