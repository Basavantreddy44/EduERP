# B4: Full Accounting, HR & Payroll: Table Structure

Common columns implied. Extends B1: `accounts, financial_years, journal_entries, journal_lines, employees, leave_types, leave_requests, staff_attendance, approval_requests`.

---

## 1. Full accounting (replaces Tally)

**Requirements:**
- Chart of accounts with groups (B1).
- Cost centres (campus/department).
- Vendors with GSTIN/PAN.
- Purchase/expense bills with GST and TDS.
- Vendor payments (partial, advance).
- Direct expense and petty-cash vouchers.
- Contra (cash ↔ bank).
- Bank accounts, statement import and reconciliation.
- Monthly period lock and year close.

Every voucher posts a balanced journal (B1). Reports come from `journal_lines`: Day Book, Cash/Bank Book, Ledger, Trial Balance, P&L / Income & Expenditure, Balance Sheet, Receipts & Payments, GST and TDS registers.

```
cost_centres
  campus_id          UUID NULL
  department_id      UUID NULL
  code               VARCHAR(20)           UQ(tenant_id, code)
  name               VARCHAR(100)
  -- journal_lines gets: cost_centre_id UUID FK NULL  (migration in B4)

tax_codes                   -- GST (configured, not hard-coded; tax expert validates)
  code               VARCHAR(20)           GST18 | GST5 | EXEMPT …
  name               VARCHAR(100)
  rate_percent       NUMERIC(5,2)
  cgst_account_id, sgst_account_id, igst_account_id  UUID FK → accounts
  effective_from     DATE
  effective_to       DATE NULL

tds_sections
  section_code       VARCHAR(10)           194C | 194J | 194I …
  description        VARCHAR(200)
  rate_individual, rate_company  NUMERIC(5,2)
  threshold_amount   NUMERIC(14,2)
  payable_account_id UUID FK → accounts
  effective_from     DATE

vendors                     -- single supplier master (also used by B6 purchase)
  vendor_code        VARCHAR(20)           UQ(tenant_id, vendor_code)
  name               VARCHAR(200)
  vendor_type        VARCHAR(20)  SUPPLIER | SERVICE | CONTRACTOR | UTILITY
  gstin              VARCHAR(15)
  pan                VARCHAR(10)
  phone, email, address, state_code
  bank_name, bank_account_no (encrypted), ifsc
  tds_section_id     UUID FK NULL
  payable_account_id UUID FK → accounts
  status             VARCHAR(20)  ACTIVE | BLOCKED

vendor_bills
  campus_id          UUID FK
  bill_no            VARCHAR(50)           vendor's invoice no   UQ(tenant_id, vendor_id, bill_no)
  internal_no        VARCHAR(30)           UQ(tenant_id, internal_no)
  vendor_id          UUID FK
  bill_date, due_date  DATE
  purchase_order_id  UUID FK NULL          B6 link (3-way match)
  goods_receipt_id   UUID FK NULL
  sub_total, tax_amount, tds_amount, total_amount  NUMERIC(14,2)
  paid_amount        NUMERIC(14,2)
  approval_request_id UUID FK NULL
  status             VARCHAR(20)  DRAFT | APPROVED | PARTIAL | PAID | CANCELLED
  journal_entry_id   UUID FK NULL

vendor_bill_items
  bill_id            UUID FK
  account_id         UUID FK               expense / asset account
  cost_centre_id     UUID FK NULL
  description        VARCHAR(300)
  quantity, rate     NUMERIC(14,2)
  amount             NUMERIC(14,2)
  tax_code_id        UUID FK NULL
  tax_amount         NUMERIC(14,2)

vendor_payments
  campus_id          UUID FK
  payment_no         VARCHAR(30)           UQ(tenant_id, payment_no)
  vendor_id          UUID FK
  payment_date       DATE
  amount             NUMERIC(14,2)
  tds_deducted       NUMERIC(14,2)
  mode               VARCHAR(20)  CASH | CHEQUE | NEFT | RTGS | UPI
  bank_account_id    UUID FK NULL
  reference_no       VARCHAR(50)
  approval_request_id UUID FK
  status             VARCHAR(20)  DRAFT | APPROVED | PAID | CANCELLED
  journal_entry_id   UUID FK NULL

vendor_payment_allocations
  vendor_payment_id  UUID FK
  bill_id            UUID FK NULL          NULL = advance
  amount             NUMERIC(14,2)

expense_vouchers            -- direct expenses / petty cash (no vendor bill)
  campus_id          UUID FK
  voucher_no         VARCHAR(30)           UQ(tenant_id, voucher_no)
  voucher_date       DATE
  expense_account_id UUID FK
  paid_from_account_id UUID FK             cash / bank / petty cash
  cost_centre_id     UUID FK NULL
  amount             NUMERIC(14,2)
  paid_to            VARCHAR(150)
  narration          VARCHAR(500)
  approval_request_id UUID FK NULL
  status             VARCHAR(20)  DRAFT | APPROVED | POSTED | CANCELLED
  journal_entry_id   UUID FK NULL

bank_accounts
  campus_id          UUID NULL
  account_id         UUID FK → accounts UQ  ledger link
  bank_name          VARCHAR(100)
  account_no         VARCHAR(30) (encrypted, show last 4)
  ifsc               VARCHAR(11)
  account_type       VARCHAR(20)  CURRENT | SAVINGS | OD
  is_fee_collection  BOOLEAN               Razorpay settlement account

bank_statement_lines        -- imported CSV/Excel
  bank_account_id    UUID FK
  txn_date           DATE
  description        VARCHAR(300)
  reference_no       VARCHAR(100)
  debit, credit      NUMERIC(14,2)
  balance            NUMERIC(14,2)
  import_batch_id    UUID
  match_status       VARCHAR(20)  UNMATCHED | MATCHED | IGNORED
  UQ(bank_account_id, txn_date, reference_no, debit, credit)   -- duplicate import guard

bank_reconciliations
  statement_line_id  UUID FK
  journal_line_id    UUID FK
  matched_by         UUID FK
  matched_at         TIMESTAMPTZ
  match_type         VARCHAR(10)  AUTO | MANUAL
  UQ(statement_line_id, journal_line_id)

period_locks                -- month close
  financial_year_id  UUID FK
  month              SMALLINT
  locked_by          UUID FK
  locked_at          TIMESTAMPTZ
  UQ(tenant_id, financial_year_id, month)
  -- posting into a locked month is rejected; unlock needs approval
```

## 2. HR

**Requirements:** full employee profile (personal, statutory, bank, qualifications, experience, documents), designations, shifts, leave balances, exit process (handover, no-dues, final settlement).

```
designations
  name               VARCHAR(100)          Principal | Lecturer | PGT | TGT | Clerk …
  code               VARCHAR(20)           UQ(tenant_id, code)
  category           VARCHAR(20)  TEACHING | NON_TEACHING | ADMIN | SUPPORT
  -- employees.designation_id → designations (B1 column)

employee_details            -- 1:1 with employees
  employee_id        UUID FK UQ
  father_or_spouse_name  VARCHAR(150)
  marital_status     VARCHAR(10)
  blood_group        VARCHAR(5)
  permanent_address, current_address  TEXT
  emergency_contact_name, emergency_contact_phone
  pan                VARCHAR(10) (encrypted)
  aadhaar_last4      CHAR(4)
  uan_no, pf_no, esi_no  VARCHAR(20)
  bank_name, bank_account_no (encrypted), ifsc
  shift_id           UUID FK NULL
  reporting_to       UUID FK → employees NULL
  confirmation_date  DATE NULL
  probation_end_date DATE NULL

employee_qualifications
  employee_id        UUID FK
  qualification      VARCHAR(100)          B.Ed | M.Sc | PhD | NET …
  institution        VARCHAR(200)
  year_of_passing    SMALLINT
  percentage         NUMERIC(5,2)
  certificate_file_id UUID NULL

employee_experiences
  employee_id        UUID FK
  organisation       VARCHAR(200)
  designation        VARCHAR(100)
  from_date, to_date DATE

shifts
  campus_id          UUID FK
  name               VARCHAR(50)
  start_time, end_time  TIME
  late_after_minutes SMALLINT
  half_day_after_minutes SMALLINT

leave_balances
  employee_id        UUID FK
  leave_type_id      UUID FK
  year               SMALLINT
  opening, allotted, used, encashed, closing  NUMERIC(5,1)
  UQ(employee_id, leave_type_id, year)
  -- updated when leave_requests (B1) are APPROVED

employee_exits
  employee_id        UUID FK UQ
  resignation_date   DATE
  last_working_date  DATE
  exit_type          VARCHAR(20)  RESIGNATION | RETIREMENT | TERMINATION | CONTRACT_END
  reason             VARCHAR(500)
  handover_to        UUID FK NULL
  no_dues_status     JSONB                 {library:true, store:true, accounts:false, hostel:true}
  settlement_amount  NUMERIC(14,2)
  status             VARCHAR(20)  INITIATED | CLEARANCE | SETTLED | CLOSED
  -- on CLOSED: user login disabled, open approvals reassigned
```

## 3. Payroll

**Requirements:**
- Salary components (earnings/deductions, fixed, % or formula).
- Salary structures by designation.
- Employee salary with effective date.
- Statutory rules for PF, ESI, Karnataka Professional Tax and TDS, configured and effective-dated.
- Monthly run: freeze attendance/leave → calculate (LOP) → review → approve by a different user → bank transfer file → paid → journal.
- Payslips (PDF, sent to staff portal).
- Loans/advances with EMI.

```
salary_components
  code               VARCHAR(20)           UQ(tenant_id, code)   BASIC | DA | HRA | PF | ESI | PT | TDS …
  name               VARCHAR(100)
  component_type     VARCHAR(10)  EARNING | DEDUCTION | EMPLOYER_CONTRIBUTION
  calc_type          VARCHAR(20)  FIXED | PERCENT_OF_BASIC | PERCENT_OF_GROSS | FORMULA | STATUTORY
  formula            VARCHAR(300) NULL
  is_taxable         BOOLEAN
  affected_by_lop    BOOLEAN               reduce for loss-of-pay days
  account_id         UUID FK → accounts
  sort_order         SMALLINT

salary_structures
  name               VARCHAR(100)          "Teaching Staff Grade A"
  designation_id     UUID FK NULL

salary_structure_items
  structure_id       UUID FK
  component_id       UUID FK
  value              NUMERIC(14,2)         amount or %
  UQ(structure_id, component_id)

employee_salary_assignments
  employee_id        UUID FK
  structure_id       UUID FK
  monthly_gross      NUMERIC(14,2)
  annual_ctc         NUMERIC(14,2)
  effective_from     DATE
  effective_to       DATE NULL
  -- only one open assignment per employee

employee_salary_components  -- per-employee overrides
  assignment_id      UUID FK
  component_id       UUID FK
  value              NUMERIC(14,2)
  UQ(assignment_id, component_id)

statutory_rules             -- PF / ESI / PT / TDS slabs (effective-dated)
  rule_type          VARCHAR(10)  PF | ESI | PT | TDS
  state_code         VARCHAR(5) NULL       PT is state-wise (KA)
  slab_from, slab_to NUMERIC(14,2)
  employee_rate      NUMERIC(7,4) NULL
  employer_rate      NUMERIC(7,4) NULL
  fixed_amount       NUMERIC(14,2) NULL
  wage_ceiling       NUMERIC(14,2) NULL
  effective_from     DATE
  effective_to       DATE NULL

payroll_runs
  campus_id          UUID NULL             NULL = all campuses
  month, year        SMALLINT
  run_no             VARCHAR(30)
  status             VARCHAR(20)  DRAFT | INPUTS_FROZEN | CALCULATED | APPROVED | PAID | POSTED | CANCELLED
  total_gross, total_deductions, total_net  NUMERIC(14,2)
  prepared_by        UUID FK
  approval_request_id UUID FK              approver ≠ prepared_by
  paid_at            TIMESTAMPTZ
  bank_file_id       UUID FK NULL
  journal_entry_id   UUID FK NULL
  UQ(tenant_id, campus_id, month, year) WHERE status <> 'CANCELLED'

payslips
  payroll_run_id     UUID FK
  employee_id        UUID FK
  working_days, paid_days, lop_days  NUMERIC(5,1)
  gross_earnings     NUMERIC(14,2)
  total_deductions   NUMERIC(14,2)
  employer_contributions NUMERIC(14,2)
  net_pay            NUMERIC(14,2)
  file_id            UUID NULL             PDF
  is_released        BOOLEAN               visible to employee
  UQ(payroll_run_id, employee_id)

payslip_items
  payslip_id         UUID FK
  component_id       UUID FK
  amount             NUMERIC(14,2)
  loan_id            UUID FK NULL          EMI deduction link

employee_loans
  employee_id        UUID FK
  loan_type          VARCHAR(20)  ADVANCE | LOAN
  amount             NUMERIC(14,2)
  emi_amount         NUMERIC(14,2)
  start_month, start_year  SMALLINT
  balance            NUMERIC(14,2)
  approval_request_id UUID FK
  status             VARCHAR(20)  PENDING | ACTIVE | CLOSED | REJECTED
```

**Payroll journal:** Dr Salary expense (per component account) / Cr Salary Payable, PF Payable, ESI Payable, PT Payable, TDS Payable, Loan recovery. On payment: Dr Salary Payable / Cr Bank.

---

**B4 table count: 30** (accounting 13 · HR 7 · payroll 10).
