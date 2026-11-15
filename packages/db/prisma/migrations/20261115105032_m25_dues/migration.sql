







-- AlterTable
ALTER TABLE "fee_invoices" ADD COLUMN     "fine_waive_reason" VARCHAR(300),
ADD COLUMN     "fine_waived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "late_fee_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_date" DATE NOT NULL,
    "invoice_count" INTEGER NOT NULL DEFAULT 0,
    "total_fine" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "late_fee_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_reminders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "sent_to" VARCHAR(150),
    "amount" DECIMAL(14,2) NOT NULL,
    "link_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "fee_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "late_fee_runs_tenant_id_run_date_idx" ON "late_fee_runs"("tenant_id", "run_date");

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_runs_tenant_id_id_key" ON "late_fee_runs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fee_reminders_tenant_id_student_id_created_at_idx" ON "fee_reminders"("tenant_id", "student_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fee_reminders_tenant_id_id_key" ON "fee_reminders"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "fee_reminders" ADD CONSTRAINT "fee_reminders_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================
ALTER TABLE "late_fee_runs" ADD CONSTRAINT late_fee_runs_source_chk CHECK (source IN ('SCHEDULE','MANUAL'));
ALTER TABLE "fee_reminders" ADD CONSTRAINT fee_reminders_status_chk CHECK (status IN ('SENT','SKIPPED'));
ALTER TABLE "fee_invoices" ADD CONSTRAINT fee_invoices_waive_chk CHECK (NOT fine_waived OR (fine_waive_reason IS NOT NULL AND fine_amount = 0));
-- Dues lists read open bills by due date.
CREATE INDEX IF NOT EXISTS fee_invoices_student_open_idx ON "fee_invoices" (tenant_id, student_id) WHERE status IN ('UNPAID','PARTIAL');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['late_fee_runs','fee_reminders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "late_fee_runs", "fee_reminders" FROM eduerp_app;
  END IF;
END $$;
