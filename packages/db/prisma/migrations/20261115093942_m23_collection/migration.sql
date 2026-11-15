







-- CreateTable
CREATE TABLE "cashier_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "opening_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "system_cash_total" DECIMAL(14,2),
    "counted_cash" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "remarks" VARCHAR(300),

    CONSTRAINT "cashier_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "receipt_no" VARCHAR(40) NOT NULL,
    "student_id" UUID NOT NULL,
    "payer_name" VARCHAR(150) NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_mode" VARCHAR(20) NOT NULL,
    "reference_no" VARCHAR(100),
    "cheque_date" DATE,
    "bank_name" VARCHAR(100),
    "notes" VARCHAR(300),
    "cashier_session_id" UUID,
    "idempotency_key" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    "cancelled_reason" VARCHAR(300),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_item_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashier_sessions_tenant_id_cashier_id_status_idx" ON "cashier_sessions"("tenant_id", "cashier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_sessions_tenant_id_id_key" ON "cashier_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_student_id_status_idx" ON "payments"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE INDEX "payments_tenant_id_payment_date_idx" ON "payments"("tenant_id", "payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_receipt_no_key" ON "payments"("tenant_id", "receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_payment_id_idx" ON "payment_allocations"("tenant_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_invoice_id_idx" ON "payment_allocations"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_tenant_id_id_key" ON "payment_allocations"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_cashier_session_id_fkey" FOREIGN KEY ("tenant_id", "cashier_session_id") REFERENCES "cashier_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_invoice_item_id_fkey" FOREIGN KEY ("tenant_id", "invoice_item_id") REFERENCES "fee_invoice_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "cashier_sessions" ADD CONSTRAINT cashier_status_chk CHECK (status IN ('OPEN','CLOSED'));
ALTER TABLE "cashier_sessions" ADD CONSTRAINT cashier_amounts_chk CHECK (opening_cash >= 0 AND (counted_cash IS NULL OR counted_cash >= 0));
ALTER TABLE "cashier_sessions" ADD CONSTRAINT cashier_closed_chk CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL AND counted_cash IS NOT NULL AND difference IS NOT NULL));
-- One open counter per cashier.
CREATE UNIQUE INDEX cashier_open_uq ON "cashier_sessions" (cashier_id) WHERE status = 'OPEN';

ALTER TABLE "payments" ADD CONSTRAINT payments_amount_chk CHECK (amount > 0);
ALTER TABLE "payments" ADD CONSTRAINT payments_mode_chk CHECK (payment_mode IN ('CASH','CHEQUE','DD','UPI','CARD','BANK_TRANSFER'));
ALTER TABLE "payments" ADD CONSTRAINT payments_status_chk CHECK (status IN ('SUCCESS','CANCELLED','BOUNCED'));
ALTER TABLE "payments" ADD CONSTRAINT payments_cancel_chk CHECK (status = 'SUCCESS' OR (cancelled_reason IS NOT NULL AND cancelled_at IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT payments_bounce_chk CHECK (status <> 'BOUNCED' OR payment_mode IN ('CHEQUE','DD'));
ALTER TABLE "payments" ADD CONSTRAINT payments_cash_session_chk CHECK (payment_mode <> 'CASH' OR cashier_session_id IS NOT NULL);
ALTER TABLE "payment_allocations" ADD CONSTRAINT allocations_amount_chk CHECK (amount > 0);

-- A receipt's money and allocations never change: only SUCCESS → CANCELLED / BOUNCED.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workflow text[] := ARRAY['status','cancelled_reason','cancelled_at','cancelled_by','journal_entry_id'];
BEGIN
  IF (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
    RAISE EXCEPTION 'payment_locked: a receipt cannot be changed, only cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'SUCCESS' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'payment_locked: a % receipt is final', lower(OLD.status) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard_trg BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION payments_guard();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cashier_sessions','payments','payment_allocations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "cashier_sessions", "payments", "payment_allocations" FROM eduerp_app;
    REVOKE UPDATE ON "payment_allocations" FROM eduerp_app;
  END IF;
END $$;
