







-- CreateTable
CREATE TABLE "student_fee_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(20) NOT NULL DEFAULT 'AUTO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "student_fee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "fee_head_id" UUID,
    "concession_type" VARCHAR(20) NOT NULL,
    "value_type" VARCHAR(10) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(6),
    "decision_remarks" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "concessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_billing_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID,
    "instalment_no" SMALLINT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "billed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "fee_billing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "invoice_no" VARCHAR(40) NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "fee_structure_id" UUID,
    "billing_run_id" UUID,
    "instalment_no" SMALLINT,
    "description" VARCHAR(200) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "concession_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fine_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance_amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    "journal_entry_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancel_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "fee_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_invoice_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "fee_head_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "concession" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fine" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fee_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_invoice_item_concessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "concession_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "fee_invoice_item_concessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "entry_no" VARCHAR(40) NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "voucher_type" VARCHAR(20) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "source_id" UUID,
    "narration" VARCHAR(500) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    "reversal_of_id" UUID,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "party_type" VARCHAR(20),
    "party_id" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_fee_assignments_tenant_id_fee_structure_id_status_idx" ON "student_fee_assignments"("tenant_id", "fee_structure_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_fee_assignments_tenant_id_id_key" ON "student_fee_assignments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "concessions_tenant_id_student_id_academic_year_id_status_idx" ON "concessions"("tenant_id", "student_id", "academic_year_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "concessions_tenant_id_id_key" ON "concessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fee_billing_runs_tenant_id_academic_year_id_created_at_idx" ON "fee_billing_runs"("tenant_id", "academic_year_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fee_billing_runs_tenant_id_id_key" ON "fee_billing_runs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fee_invoices_tenant_id_student_id_status_idx" ON "fee_invoices"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_invoices_tenant_id_id_key" ON "fee_invoices"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_invoices_tenant_id_invoice_no_key" ON "fee_invoices"("tenant_id", "invoice_no");

-- CreateIndex
CREATE INDEX "fee_invoice_items_tenant_id_invoice_id_idx" ON "fee_invoice_items"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_invoice_items_tenant_id_id_key" ON "fee_invoice_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fee_invoice_item_concessions_tenant_id_concession_id_idx" ON "fee_invoice_item_concessions"("tenant_id", "concession_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_invoice_item_concessions_tenant_id_id_key" ON "fee_invoice_item_concessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_invoice_item_concessions_item_id_concession_id_key" ON "fee_invoice_item_concessions"("item_id", "concession_id");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_type_source_id_idx" ON "journal_entries"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_id_key" ON "journal_entries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_entry_no_key" ON "journal_entries"("tenant_id", "entry_no");

-- CreateIndex
CREATE INDEX "journal_lines_tenant_id_journal_entry_id_idx" ON "journal_lines"("tenant_id", "journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_tenant_id_account_id_idx" ON "journal_lines"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_lines_tenant_id_party_type_party_id_idx" ON "journal_lines"("tenant_id", "party_type", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_tenant_id_id_key" ON "journal_lines"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_tenant_id_fee_structure_id_fkey" FOREIGN KEY ("tenant_id", "fee_structure_id") REFERENCES "fee_structures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_tenant_id_fee_head_id_fkey" FOREIGN KEY ("tenant_id", "fee_head_id") REFERENCES "fee_heads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_billing_runs" ADD CONSTRAINT "fee_billing_runs_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_tenant_id_fee_structure_id_fkey" FOREIGN KEY ("tenant_id", "fee_structure_id") REFERENCES "fee_structures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_tenant_id_billing_run_id_fkey" FOREIGN KEY ("tenant_id", "billing_run_id") REFERENCES "fee_billing_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoice_items" ADD CONSTRAINT "fee_invoice_items_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoice_items" ADD CONSTRAINT "fee_invoice_items_tenant_id_fee_head_id_fkey" FOREIGN KEY ("tenant_id", "fee_head_id") REFERENCES "fee_heads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoice_item_concessions" ADD CONSTRAINT "fee_invoice_item_concessions_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "fee_invoice_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_invoice_item_concessions" ADD CONSTRAINT "fee_invoice_item_concessions_tenant_id_concession_id_fkey" FOREIGN KEY ("tenant_id", "concession_id") REFERENCES "concessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_financial_year_id_fkey" FOREIGN KEY ("tenant_id", "financial_year_id") REFERENCES "financial_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_reversal_of_id_fkey" FOREIGN KEY ("tenant_id", "reversal_of_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_journal_entry_id_fkey" FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "student_fee_assignments" ADD CONSTRAINT fee_assign_status_chk CHECK (status IN ('ACTIVE','CANCELLED'));
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT fee_assign_source_chk CHECK (source IN ('AUTO','MANUAL'));
CREATE UNIQUE INDEX fee_assign_active_uq ON "student_fee_assignments" (student_id, academic_year_id) WHERE status = 'ACTIVE';

ALTER TABLE "concessions" ADD CONSTRAINT concessions_type_chk CHECK (concession_type IN ('SIBLING','MERIT','STAFF_CHILD','SCHOLARSHIP','MANAGEMENT','OTHER'));
ALTER TABLE "concessions" ADD CONSTRAINT concessions_value_chk CHECK (value > 0 AND (value_type = 'AMOUNT' OR (value_type = 'PERCENT' AND value <= 100)));
ALTER TABLE "concessions" ADD CONSTRAINT concessions_status_chk CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));

-- Bills: the amounts always add up; one live bill per student, year and instalment.
ALTER TABLE "fee_invoices" ADD CONSTRAINT fee_invoices_status_chk CHECK (status IN ('UNPAID','PARTIAL','PAID','CANCELLED'));
ALTER TABLE "fee_invoices" ADD CONSTRAINT fee_invoices_amounts_chk CHECK (
  gross_amount >= 0 AND concession_amount >= 0 AND fine_amount >= 0 AND paid_amount >= 0
  AND concession_amount <= gross_amount
  AND net_amount = gross_amount - concession_amount + fine_amount
  AND balance_amount = net_amount - paid_amount AND paid_amount <= net_amount);
ALTER TABLE "fee_invoices" ADD CONSTRAINT fee_invoices_cancel_chk CHECK (status <> 'CANCELLED' OR (cancel_reason IS NOT NULL AND paid_amount = 0));
CREATE UNIQUE INDEX fee_invoices_instalment_uq ON "fee_invoices" (student_id, academic_year_id, instalment_no) WHERE status <> 'CANCELLED' AND instalment_no IS NOT NULL;
CREATE INDEX fee_invoices_open_idx ON "fee_invoices" (tenant_id, campus_id, due_date) WHERE status IN ('UNPAID','PARTIAL');

ALTER TABLE "fee_invoice_items" ADD CONSTRAINT fee_items_amounts_chk CHECK (
  amount >= 0 AND concession >= 0 AND fine >= 0 AND paid_amount >= 0 AND concession <= amount
  AND net_amount = amount - concession + fine AND paid_amount <= net_amount);
ALTER TABLE "fee_invoice_item_concessions" ADD CONSTRAINT fee_item_conc_amount_chk CHECK (amount > 0);

-- Journal: balanced, and posted entries never change (only POSTED → REVERSED).
ALTER TABLE "journal_entries" ADD CONSTRAINT journal_voucher_chk CHECK (voucher_type IN ('RECEIPT','PAYMENT','JOURNAL','CONTRA','SALES','PURCHASE'));
ALTER TABLE "journal_entries" ADD CONSTRAINT journal_status_chk CHECK (status IN ('POSTED','REVERSED'));
ALTER TABLE "journal_entries" ADD CONSTRAINT journal_total_chk CHECK (total_amount > 0);
ALTER TABLE "journal_lines" ADD CONSTRAINT journal_lines_amount_chk CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0));

CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; t numeric; n int;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM journal_lines WHERE journal_entry_id = NEW.journal_entry_id;
  SELECT total_amount INTO t FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF n < 2 OR d <> c OR d <> t THEN
    RAISE EXCEPTION 'journal_unbalanced: entry % has debit % and credit % (total %)', NEW.journal_entry_id, d, c, t USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
-- Checked at commit, after all lines of the entry are in.
CREATE CONSTRAINT TRIGGER journal_balanced_trg AFTER INSERT ON "journal_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

CREATE OR REPLACE FUNCTION journal_entry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'journal_immutable: posted entries are reversed, never deleted' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'POSTED' OR NEW.status <> 'REVERSED'
     OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'journal_immutable: a posted entry can only be marked reversed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entry_immutable_trg BEFORE UPDATE OR DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION journal_entry_immutable();

CREATE OR REPLACE FUNCTION journal_line_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'journal_immutable: journal lines never change' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER journal_line_immutable_trg BEFORE UPDATE OR DELETE ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION journal_line_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_fee_assignments','concessions','fee_billing_runs','fee_invoices','fee_invoice_items','fee_invoice_item_concessions','journal_entries','journal_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Money records are cancelled or reversed, never deleted.
    REVOKE DELETE, TRUNCATE ON "student_fee_assignments", "concessions", "fee_billing_runs", "fee_invoices", "fee_invoice_items",
      "fee_invoice_item_concessions", "journal_entries", "journal_lines" FROM eduerp_app;
    REVOKE UPDATE ON "journal_lines", "fee_invoice_item_concessions" FROM eduerp_app;
  END IF;
END $$;
