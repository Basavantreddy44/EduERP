-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "cost_centre_id" UUID;

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "campus_id" UUID,
    "department_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rate_percent" DECIMAL(5,2) NOT NULL,
    "itc_claimable" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_code" VARCHAR(10) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "rate_individual" DECIMAL(5,2) NOT NULL,
    "rate_others" DECIMAL(5,2) NOT NULL,
    "rate_no_pan" DECIMAL(5,2) NOT NULL,
    "threshold_single" DECIMAL(14,2),
    "threshold_annual" DECIMAL(14,2),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tds_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "account_id" UUID NOT NULL,
    "bank_name" VARCHAR(100) NOT NULL,
    "branch" VARCHAR(100),
    "account_no_enc" VARCHAR(200) NOT NULL,
    "account_no_last4" VARCHAR(4) NOT NULL,
    "ifsc" VARCHAR(11) NOT NULL,
    "account_type" VARCHAR(10) NOT NULL,
    "is_fee_collection" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_locks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "month_start" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "locked_by" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlock_reason" VARCHAR(300),
    "unlock_requested_by" UUID,
    "approval_request_id" UUID,
    "unlocked_at" TIMESTAMPTZ(6),

    CONSTRAINT "period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "vendor_type" VARCHAR(20) NOT NULL,
    "gstin" VARCHAR(15),
    "pan_enc" VARCHAR(200),
    "pan_last4" VARCHAR(4),
    "pan_holder" VARCHAR(10) NOT NULL DEFAULT 'NONE',
    "state_code" VARCHAR(2) NOT NULL,
    "phone" VARCHAR(15),
    "email" VARCHAR(150),
    "address" VARCHAR(500),
    "bank_name" VARCHAR(100),
    "bank_account_enc" VARCHAR(200),
    "bank_account_last4" VARCHAR(4),
    "ifsc" VARCHAR(11),
    "tds_section_id" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "internal_no" VARCHAR(30) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "bill_no" VARCHAR(50) NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE,
    "purchase_order_id" UUID,
    "goods_receipt_id" UUID,
    "sub_total" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "tds_section_id" UUID,
    "tds_rate" DECIMAL(5,2),
    "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "payable_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "journal_entry_id" UUID,
    "cancel_reason" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_code_id" UUID,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "itc_claimable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vendor_bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "payment_no" VARCHAR(30) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "advance_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advance_used" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "mode" VARCHAR(10) NOT NULL,
    "bank_account_id" UUID,
    "reference_no" VARCHAR(50),
    "narration" VARCHAR(300),
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "journal_entry_id" UUID,
    "cancel_reason" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "is_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "journal_entry_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_vouchers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "voucher_no" VARCHAR(30) NOT NULL,
    "voucher_type" VARCHAR(10) NOT NULL,
    "voucher_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_to" VARCHAR(150),
    "reference_no" VARCHAR(50),
    "narration" VARCHAR(500) NOT NULL,
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "journal_entry_id" UUID,
    "cancel_reason" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_voucher_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "account_voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "line_count" INTEGER NOT NULL,
    "added_count" INTEGER NOT NULL,
    "imported_by" UUID NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "txn_date" DATE NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "reference_no" VARCHAR(100),
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2),
    "fingerprint" VARCHAR(64) NOT NULL,
    "match_status" VARCHAR(10) NOT NULL DEFAULT 'UNMATCHED',
    "ignore_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "statement_line_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,
    "match_type" VARCHAR(10) NOT NULL,
    "matched_by" UUID NOT NULL,
    "matched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_tenant_id_id_key" ON "cost_centres"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_tenant_id_code_key" ON "cost_centres"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_tenant_id_id_key" ON "tax_codes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_tenant_id_code_effective_from_key" ON "tax_codes"("tenant_id", "code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tds_sections_tenant_id_id_key" ON "tds_sections"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tds_sections_tenant_id_section_code_effective_from_key" ON "tds_sections"("tenant_id", "section_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_tenant_id_id_key" ON "bank_accounts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_tenant_id_account_id_key" ON "bank_accounts"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "period_locks_tenant_id_id_key" ON "period_locks"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "period_locks_tenant_id_month_start_key" ON "period_locks"("tenant_id", "month_start");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenant_id_id_key" ON "vendors"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenant_id_vendor_code_key" ON "vendors"("tenant_id", "vendor_code");

-- CreateIndex
CREATE INDEX "vendor_bills_tenant_id_vendor_id_status_idx" ON "vendor_bills"("tenant_id", "vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_tenant_id_id_key" ON "vendor_bills"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_tenant_id_internal_no_key" ON "vendor_bills"("tenant_id", "internal_no");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bill_items_tenant_id_id_key" ON "vendor_bill_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bill_items_bill_id_line_no_key" ON "vendor_bill_items"("bill_id", "line_no");

-- CreateIndex
CREATE INDEX "vendor_payments_tenant_id_vendor_id_idx" ON "vendor_payments"("tenant_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_tenant_id_id_key" ON "vendor_payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_tenant_id_payment_no_key" ON "vendor_payments"("tenant_id", "payment_no");

-- CreateIndex
CREATE INDEX "vendor_payment_allocations_tenant_id_bill_id_idx" ON "vendor_payment_allocations"("tenant_id", "bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_allocations_tenant_id_id_key" ON "vendor_payment_allocations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_vouchers_tenant_id_id_key" ON "account_vouchers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_vouchers_tenant_id_voucher_no_key" ON "account_vouchers"("tenant_id", "voucher_no");

-- CreateIndex
CREATE UNIQUE INDEX "account_voucher_lines_tenant_id_id_key" ON "account_voucher_lines"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_voucher_lines_voucher_id_line_no_key" ON "account_voucher_lines"("voucher_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_tenant_id_id_key" ON "bank_statement_imports"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_tenant_id_bank_account_id_match_status_idx" ON "bank_statement_lines"("tenant_id", "bank_account_id", "match_status", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_tenant_id_id_key" ON "bank_statement_lines"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_tenant_id_bank_account_id_fingerprint_key" ON "bank_statement_lines"("tenant_id", "bank_account_id", "fingerprint");

-- CreateIndex
CREATE INDEX "bank_reconciliations_tenant_id_statement_line_id_idx" ON "bank_reconciliations"("tenant_id", "statement_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_tenant_id_id_key" ON "bank_reconciliations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_tenant_id_journal_line_id_key" ON "bank_reconciliations"("tenant_id", "journal_line_id");

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_tenant_id_vendor_id_fkey" FOREIGN KEY ("tenant_id", "vendor_id") REFERENCES "vendors"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT "vendor_bill_items_tenant_id_bill_id_fkey" FOREIGN KEY ("tenant_id", "bill_id") REFERENCES "vendor_bills"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_tenant_id_vendor_id_fkey" FOREIGN KEY ("tenant_id", "vendor_id") REFERENCES "vendors"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "vendor_payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_tenant_id_bill_id_fkey" FOREIGN KEY ("tenant_id", "bill_id") REFERENCES "vendor_bills"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_voucher_lines" ADD CONSTRAINT "account_voucher_lines_tenant_id_voucher_id_fkey" FOREIGN KEY ("tenant_id", "voucher_id") REFERENCES "account_vouchers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_tenant_id_bank_account_id_fkey" FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_tenant_id_statement_line_id_fkey" FOREIGN KEY ("tenant_id", "statement_line_id") REFERENCES "bank_statement_lines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links to existing tables.
ALTER TABLE "journal_lines" ADD CONSTRAINT journal_lines_cost_centre_fkey FOREIGN KEY ("tenant_id", "cost_centre_id") REFERENCES "cost_centres"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "cost_centres" ADD CONSTRAINT cost_centres_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "cost_centres" ADD CONSTRAINT cost_centres_department_fkey FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT bank_accounts_account_fkey FOREIGN KEY ("tenant_id", "account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT bank_accounts_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendors" ADD CONSTRAINT vendors_tds_fkey FOREIGN KEY ("tenant_id", "tds_section_id") REFERENCES "tds_sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bills" ADD CONSTRAINT vendor_bills_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bills" ADD CONSTRAINT vendor_bills_tds_fkey FOREIGN KEY ("tenant_id", "tds_section_id") REFERENCES "tds_sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bills" ADD CONSTRAINT vendor_bills_journal_fkey FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT bill_items_account_fkey FOREIGN KEY ("tenant_id", "account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT bill_items_cost_centre_fkey FOREIGN KEY ("tenant_id", "cost_centre_id") REFERENCES "cost_centres"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT bill_items_tax_fkey FOREIGN KEY ("tenant_id", "tax_code_id") REFERENCES "tax_codes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_payments" ADD CONSTRAINT vendor_payments_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_payments" ADD CONSTRAINT vendor_payments_bank_fkey FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_payments" ADD CONSTRAINT vendor_payments_journal_fkey FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT allocations_journal_fkey FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "account_vouchers" ADD CONSTRAINT vouchers_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "account_vouchers" ADD CONSTRAINT vouchers_journal_fkey FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "account_voucher_lines" ADD CONSTRAINT voucher_lines_account_fkey FOREIGN KEY ("tenant_id", "account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "account_voucher_lines" ADD CONSTRAINT voucher_lines_cost_centre_fkey FOREIGN KEY ("tenant_id", "cost_centre_id") REFERENCES "cost_centres"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT statement_imports_bank_fkey FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT statement_lines_import_fkey FOREIGN KEY ("tenant_id", "import_id") REFERENCES "bank_statement_imports"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT reconciliations_journal_line_fkey FOREIGN KEY ("tenant_id", "journal_line_id") REFERENCES "journal_lines"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "tax_codes" ADD CONSTRAINT tax_codes_chk CHECK (rate_percent BETWEEN 0 AND 100 AND (effective_to IS NULL OR effective_to >= effective_from));
ALTER TABLE "tds_sections" ADD CONSTRAINT tds_sections_chk CHECK (rate_individual BETWEEN 0 AND 100 AND rate_others BETWEEN 0 AND 100 AND rate_no_pan BETWEEN 0 AND 100 AND (effective_to IS NULL OR effective_to >= effective_from));
ALTER TABLE "bank_accounts" ADD CONSTRAINT bank_accounts_chk CHECK (account_type IN ('CURRENT','SAVINGS','OD') AND account_no_last4 ~ '^\d{4}$' AND ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$' AND account_no_enc LIKE 'v1:%');
ALTER TABLE "period_locks" ADD CONSTRAINT period_locks_chk CHECK (status IN ('LOCKED','UNLOCKING','UNLOCKED') AND extract(day FROM month_start) = 1);
-- Bank account numbers and PAN are stored only encrypted (CD-84).
ALTER TABLE "vendors" ADD CONSTRAINT vendors_chk CHECK (
  vendor_type IN ('SUPPLIER','SERVICE','CONTRACTOR','UTILITY','LANDLORD','PROFESSIONAL') AND status IN ('ACTIVE','BLOCKED')
  AND state_code ~ '^\d{2}$' AND pan_holder IN ('INDIVIDUAL','OTHER','NONE')
  AND (gstin IS NULL OR gstin ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
  AND (pan_enc IS NULL OR pan_enc LIKE 'v1:%') AND (bank_account_enc IS NULL OR bank_account_enc LIKE 'v1:%')
  AND (pan_enc IS NULL) = (pan_last4 IS NULL) AND (bank_account_enc IS NULL) = (bank_account_last4 IS NULL));
ALTER TABLE "vendor_bills" ADD CONSTRAINT vendor_bills_chk CHECK (
  status IN ('PENDING_APPROVAL','APPROVED','PARTIAL','PAID','REJECTED','CANCELLED')
  AND sub_total > 0 AND tax_amount >= 0 AND tds_amount >= 0
  AND total_amount = sub_total + tax_amount AND payable_amount = total_amount - tds_amount
  AND paid_amount >= 0 AND paid_amount <= payable_amount
  AND (due_date IS NULL OR due_date >= bill_date)
  AND (status NOT IN ('APPROVED','PARTIAL','PAID') OR journal_entry_id IS NOT NULL));
CREATE UNIQUE INDEX vendor_bills_vendor_no_uq ON "vendor_bills" ("tenant_id", "vendor_id", upper("bill_no")) WHERE status <> 'CANCELLED' AND status <> 'REJECTED';
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT bill_items_chk CHECK (quantity > 0 AND rate > 0 AND amount > 0 AND cgst >= 0 AND sgst >= 0 AND igst >= 0 AND (igst = 0 OR (cgst = 0 AND sgst = 0)));
ALTER TABLE "vendor_payments" ADD CONSTRAINT vendor_payments_chk CHECK (
  mode IN ('CASH','CHEQUE','NEFT','RTGS','UPI') AND status IN ('PENDING_APPROVAL','PAID','REJECTED','CANCELLED')
  AND amount > 0 AND advance_amount >= 0 AND advance_amount <= amount AND advance_used >= 0 AND advance_used <= advance_amount
  AND (mode = 'CASH' OR bank_account_id IS NOT NULL)
  AND (status <> 'PAID' OR journal_entry_id IS NOT NULL));
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT allocations_chk CHECK (amount > 0);
ALTER TABLE "account_vouchers" ADD CONSTRAINT vouchers_chk CHECK (
  voucher_type IN ('EXPENSE','CONTRA','JOURNAL','OPENING','BANK') AND status IN ('PENDING_APPROVAL','POSTED','REJECTED','CANCELLED')
  AND amount > 0 AND (status <> 'POSTED' OR journal_entry_id IS NOT NULL));
ALTER TABLE "account_voucher_lines" ADD CONSTRAINT voucher_lines_chk CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0));
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT statement_lines_chk CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0) AND match_status IN ('UNMATCHED','MATCHED','IGNORED') AND (match_status <> 'IGNORED' OR ignore_reason IS NOT NULL));
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT reconciliations_chk CHECK (match_type IN ('AUTO','MANUAL'));

-- Nothing posts into a locked month or a closed financial year (except the year-closing entry itself).
CREATE OR REPLACE FUNCTION journal_period_open() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM period_locks WHERE tenant_id = NEW.tenant_id AND month_start = date_trunc('month', NEW.entry_date)::date AND status <> 'UNLOCKED') THEN
    RAISE EXCEPTION 'The month of % is locked', to_char(NEW.entry_date, 'Mon YYYY') USING ERRCODE = 'check_violation', CONSTRAINT = 'period_locked';
  END IF;
  IF NEW.source_type <> 'YEAR_CLOSE' AND EXISTS (SELECT 1 FROM financial_years WHERE tenant_id = NEW.tenant_id AND id = NEW.financial_year_id AND is_closed) THEN
    RAISE EXCEPTION 'The financial year is closed' USING ERRCODE = 'check_violation', CONSTRAINT = 'year_closed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER journal_period_open BEFORE INSERT ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION journal_period_open();

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cost_centres','tax_codes','tds_sections','bank_accounts','period_locks','vendors','vendor_bills','vendor_bill_items','vendor_payments','vendor_payment_allocations','account_vouchers','account_voucher_lines','bank_statement_imports','bank_statement_lines','bank_reconciliations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Accounting records are never deleted; an unmatch removes only the reconciliation link.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "cost_centres", "tax_codes", "tds_sections", "bank_accounts", "period_locks", "vendors", "vendor_bills", "vendor_bill_items", "vendor_payments", "vendor_payment_allocations", "account_vouchers", "account_voucher_lines", "bank_statement_imports", "bank_statement_lines" FROM eduerp_app;
    REVOKE TRUNCATE ON "bank_reconciliations" FROM eduerp_app;
  END IF;
END $$;
