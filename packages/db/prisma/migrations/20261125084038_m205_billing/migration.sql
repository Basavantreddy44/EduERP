
-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "edition" VARCHAR(20),
ADD COLUMN     "price_monthly" DECIMAL(10,2),
ADD COLUMN     "price_yearly" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN     "billing_cycle" VARCHAR(10) NOT NULL DEFAULT 'YEARLY',
ADD COLUMN     "next_cycle" VARCHAR(10),
ADD COLUMN     "rate" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billing_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billing_state" VARCHAR(100),
ADD COLUMN     "grace_days" INTEGER,
ADD COLUMN     "gstin" VARCHAR(15);

-- AlterTable
-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "grace_days" INTEGER NOT NULL DEFAULT 30,
    "renew_lead_days" INTEGER NOT NULL DEFAULT 15,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "invoice_prefix" VARCHAR(10) NOT NULL DEFAULT 'EDU',
    "seller_name" VARCHAR(200) NOT NULL DEFAULT 'EduERP',
    "seller_address" VARCHAR(500) NOT NULL DEFAULT '',
    "seller_state" VARCHAR(100) NOT NULL DEFAULT 'Karnataka',
    "seller_gstin" VARCHAR(15),
    "sac_code" VARCHAR(8),
    "bank_name" VARCHAR(100),
    "bank_account_name" VARCHAR(150),
    "bank_account_no" VARCHAR(20),
    "bank_ifsc" VARCHAR(11),
    "upi_id" VARCHAR(100),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoice_counters" (
    "fy" VARCHAR(7) NOT NULL,
    "last_no" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_invoice_counters_pkey" PRIMARY KEY ("fy")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "invoice_no" VARCHAR(30) NOT NULL,
    "fy" VARCHAR(7) NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "plan_name" VARCHAR(100) NOT NULL,
    "edition" VARCHAR(20) NOT NULL,
    "billing_cycle" VARCHAR(10) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "student_count" INTEGER NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'UNPAID',
    "buyer" JSONB NOT NULL,
    "seller" JSONB NOT NULL,
    "cancel_reason" VARCHAR(300),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" VARCHAR(15) NOT NULL,
    "reference" VARCHAR(60),
    "note" VARCHAR(200),
    "status" VARCHAR(10) NOT NULL DEFAULT 'RECORDED',
    "reverse_reason" VARCHAR(300),
    "reversed_at" TIMESTAMPTZ(6),
    "reversed_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_reminders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ref_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_invoice_no_key" ON "platform_invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "platform_invoices_tenant_id_issue_date_idx" ON "platform_invoices"("tenant_id", "issue_date");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_date_idx" ON "platform_invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_fy_seq_key" ON "platform_invoices"("fy", "seq");

-- CreateIndex
CREATE INDEX "platform_payments_tenant_id_paid_on_idx" ON "platform_payments"("tenant_id", "paid_on");

-- CreateIndex
CREATE INDEX "platform_payments_invoice_id_idx" ON "platform_payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reminders_ref_id_kind_key" ON "billing_reminders"("ref_id", "kind");

-- AddForeignKey
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "platform_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Existing plans: the old price is the yearly or the monthly price; existing subscriptions keep their plan's cycle and price.
UPDATE "plans" SET "price_yearly" = "price_per_student" WHERE "billing_cycle" = 'YEARLY' AND "price_yearly" IS NULL AND "price_per_student" > 0;
UPDATE "plans" SET "price_monthly" = "price_per_student" WHERE "billing_cycle" = 'MONTHLY' AND "price_monthly" IS NULL AND "price_per_student" > 0;
UPDATE "tenant_subscriptions" s SET "billing_cycle" = p."billing_cycle", "rate" = p."price_per_student" FROM "plans" p WHERE p."id" = s."plan_id";

-- The single settings row (grace period 30 days by default, CD-126).
INSERT INTO "platform_billing_settings" ("id", "updated_at") VALUES (1, now()) ON CONFLICT DO NOTHING;

-- Links.
ALTER TABLE "platform_invoices" ADD CONSTRAINT platform_invoices_tenant_fkey FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "platform_invoices" ADD CONSTRAINT platform_invoices_sub_fkey FOREIGN KEY ("subscription_id") REFERENCES "tenant_subscriptions"("id") ON DELETE RESTRICT;
ALTER TABLE "platform_payments" ADD CONSTRAINT platform_payments_tenant_fkey FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "billing_reminders" ADD CONSTRAINT billing_reminders_tenant_fkey FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "plans" ADD CONSTRAINT plans_edition_chk CHECK ("edition" IS NULL OR "edition" IN ('STANDARD','RESIDENTIAL'));
ALTER TABLE "plans" ADD CONSTRAINT plans_prices_chk CHECK (("price_monthly" IS NULL OR "price_monthly" > 0) AND ("price_yearly" IS NULL OR "price_yearly" > 0));
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT tenant_subscriptions_cycle_chk CHECK ("billing_cycle" IN ('MONTHLY','YEARLY') AND ("next_cycle" IS NULL OR "next_cycle" IN ('MONTHLY','YEARLY')) AND "rate" >= 0);
ALTER TABLE "tenants" ADD CONSTRAINT tenants_grace_chk CHECK ("grace_days" IS NULL OR "grace_days" BETWEEN 1 AND 90);
ALTER TABLE "platform_billing_settings" ADD CONSTRAINT billing_settings_chk CHECK (
  "id" = 1 AND "grace_days" BETWEEN 1 AND 90 AND "renew_lead_days" BETWEEN 1 AND 60 AND "gst_rate" BETWEEN 0 AND 28);
ALTER TABLE "platform_invoices" ADD CONSTRAINT platform_invoices_chk CHECK (
  "status" IN ('UNPAID','PART_PAID','PAID','CANCELLED') AND "kind" IN ('FIRST','RENEWAL') AND "billing_cycle" IN ('MONTHLY','YEARLY')
  AND "period_end" >= "period_start" AND "student_count" >= 0 AND "taxable" >= 0 AND "total" >= "taxable"
  AND "paid" >= 0 AND "paid" <= "total" AND "seq" > 0
  AND (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)) AND ("status" <> 'CANCELLED' OR "paid" = 0));
ALTER TABLE "platform_payments" ADD CONSTRAINT platform_payments_chk CHECK (
  "amount" > 0 AND "mode" IN ('BANK_TRANSFER','UPI','CHEQUE','CASH','OTHER') AND "status" IN ('RECORDED','REVERSED')
  AND (("status" = 'REVERSED') = ("reversed_at" IS NOT NULL)));
-- One live invoice per subscription and term.
CREATE UNIQUE INDEX platform_invoices_term_uq ON "platform_invoices"("subscription_id", "period_start") WHERE "status" <> 'CANCELLED';

-- Platform-only tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_billing_settings','platform_invoice_counters','billing_reminders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform())', t || '_platform', t);
  END LOOP;
END $$;

-- Invoices and payments: an institution reads its own; only the platform changes them.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_invoices','platform_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = app_current_tenant() OR app_is_platform())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform())', t || '_write', t);
  END LOOP;
END $$;

-- Bills, payments and reminders are records: never deleted by the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "platform_billing_settings", "platform_invoice_counters", "platform_invoices", "platform_payments", "billing_reminders" FROM eduerp_app;
  END IF;
END $$;
