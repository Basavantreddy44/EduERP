








































































































































































































































































































































-- AlterTable

-- AlterTable
ALTER TABLE "fee_invoices" ADD COLUMN     "opening_year_label" VARCHAR(9);

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'RECEIPT',
ALTER COLUMN "payment_id" DROP NOT NULL;

-- AlterTable

-- CreateTable
CREATE TABLE "fee_credit_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "adjustment_no" VARCHAR(40) NOT NULL,
    "adjusted_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "note" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "journal_entry_id" UUID,
    "cancel_reason" VARCHAR(300),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "fee_credit_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_credit_adjustment_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_item_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "fee_credit_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_credit_adjustments_tenant_id_student_id_idx" ON "fee_credit_adjustments"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_credit_adjustments_tenant_id_id_key" ON "fee_credit_adjustments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_credit_adjustments_tenant_id_adjustment_no_key" ON "fee_credit_adjustments"("tenant_id", "adjustment_no");

-- CreateIndex
CREATE INDEX "fee_credit_adjustment_lines_tenant_id_invoice_id_idx" ON "fee_credit_adjustment_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_credit_adjustment_lines_tenant_id_id_key" ON "fee_credit_adjustment_lines"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "fee_credit_adjustment_lines" ADD CONSTRAINT "fee_credit_adjustment_lines_tenant_id_adjustment_id_fkey" FOREIGN KEY ("tenant_id", "adjustment_id") REFERENCES "fee_credit_adjustments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ───────────── Hand-written section (Phase 23 fees at go-live) ─────────────
-- Foreign keys (composite with tenant, as everywhere).
ALTER TABLE "fee_credit_adjustments" ADD CONSTRAINT credit_adj_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "fee_credit_adjustments" ADD CONSTRAINT credit_adj_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "fee_credit_adjustment_lines" ADD CONSTRAINT credit_adj_line_invoice_fkey FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "fee_credit_adjustment_lines" ADD CONSTRAINT credit_adj_line_item_fkey FOREIGN KEY ("tenant_id", "invoice_item_id") REFERENCES "fee_invoice_items"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "fee_credit_adjustments" ADD CONSTRAINT credit_adj_chk CHECK (
  amount > 0 AND source IN ('MANUAL','AUTO') AND status IN ('ACTIVE','CANCELLED')
  AND (status <> 'ACTIVE' OR journal_entry_id IS NOT NULL)
  AND (status <> 'CANCELLED' OR (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)));
ALTER TABLE "fee_credit_adjustment_lines" ADD CONSTRAINT credit_adj_line_chk CHECK (amount > 0);
ALTER TABLE "refunds" ADD CONSTRAINT refunds_kind_chk CHECK (
  (kind = 'RECEIPT' AND payment_id IS NOT NULL) OR (kind = 'CREDIT' AND payment_id IS NULL AND refund_mode <> 'ONLINE'));
ALTER TABLE "fee_invoices" ADD CONSTRAINT fee_invoices_opening_chk CHECK (opening_year_label IS NULL OR opening_year_label ~ '^[0-9]{4}-[0-9]{2}$');
-- One live opening-dues bill per student and year label.
CREATE UNIQUE INDEX fee_invoices_opening_uq ON "fee_invoices"("tenant_id", "student_id", "opening_year_label") WHERE opening_year_label IS NOT NULL AND status <> 'CANCELLED';

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_credit_adjustments','fee_credit_adjustment_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Money records: never deleted by the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "fee_credit_adjustments", "fee_credit_adjustment_lines" FROM eduerp_app;
  END IF;
END $$;
