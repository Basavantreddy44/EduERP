







-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "invoice_ids" UUID[],
    "amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_to" VARCHAR(150),
    "paid_payment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'RAZORPAY',
    "gateway_order_id" VARCHAR(60) NOT NULL,
    "gateway_payment_id" VARCHAR(60),
    "amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    "payment_id" UUID,
    "failure_reason" VARCHAR(300),
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_payment_routes" (
    "key" VARCHAR(120) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_payment_routes_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(80),
    "event_type" VARCHAR(60),
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "tenant_id" UUID,
    "processed_at" TIMESTAMPTZ(6),
    "result" VARCHAR(300),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "refund_mode" VARCHAR(20) NOT NULL,
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "gateway_refund_id" VARCHAR(60),
    "journal_entry_id" UUID,
    "failure_reason" VARCHAR(300),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_hash_key" ON "payment_links"("token_hash");

-- CreateIndex
CREATE INDEX "payment_links_tenant_id_student_id_status_idx" ON "payment_links"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_tenant_id_id_key" ON "payment_links"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_gateway_order_id_key" ON "online_orders"("gateway_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_gateway_payment_id_key" ON "online_orders"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "online_orders_tenant_id_status_created_at_idx" ON "online_orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_tenant_id_id_key" ON "online_orders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "public_payment_routes_tenant_id_idx" ON "public_payment_routes"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_received_at_idx" ON "payment_webhook_events"("provider", "received_at");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_payment_id_status_idx" ON "refunds"("tenant_id", "payment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_tenant_id_id_key" ON "refunds"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_tenant_id_link_id_fkey" FOREIGN KEY ("tenant_id", "link_id") REFERENCES "payment_links"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ONLINE payments (gateway only) join the counter modes.
ALTER TABLE "payments" DROP CONSTRAINT payments_mode_chk;
ALTER TABLE "payments" ADD CONSTRAINT payments_mode_chk CHECK (payment_mode IN ('CASH','CHEQUE','DD','UPI','CARD','BANK_TRANSFER','ONLINE'));

ALTER TABLE "payment_links" ADD CONSTRAINT pay_links_status_chk CHECK (status IN ('ACTIVE','PAID','CANCELLED','EXPIRED'));
ALTER TABLE "payment_links" ADD CONSTRAINT pay_links_amount_chk CHECK (amount > 0);
ALTER TABLE "payment_links" ADD CONSTRAINT pay_links_paid_chk CHECK ((status = 'PAID') = (paid_payment_id IS NOT NULL));

ALTER TABLE "online_orders" ADD CONSTRAINT online_orders_status_chk CHECK (status IN ('CREATED','PAID','FAILED'));
ALTER TABLE "online_orders" ADD CONSTRAINT online_orders_amount_chk CHECK (amount > 0);
ALTER TABLE "online_orders" ADD CONSTRAINT online_orders_paid_chk CHECK ((status = 'PAID') = (payment_id IS NOT NULL AND gateway_payment_id IS NOT NULL));

ALTER TABLE "refunds" ADD CONSTRAINT refunds_status_chk CHECK (status IN ('PENDING','PAID','REJECTED','FAILED','CANCELLED'));
ALTER TABLE "refunds" ADD CONSTRAINT refunds_amount_chk CHECK (amount > 0);
ALTER TABLE "refunds" ADD CONSTRAINT refunds_mode_chk CHECK (refund_mode IN ('ONLINE','CASH','BANK_TRANSFER','CHEQUE'));
ALTER TABLE "refunds" ADD CONSTRAINT refunds_paid_chk CHECK (status <> 'PAID' OR journal_entry_id IS NOT NULL);

-- A gateway payment id is recorded once per institution's payments too (receipt only once per capture).
CREATE UNIQUE INDEX payments_gateway_ref_uq ON "payments" (tenant_id, reference_no) WHERE payment_mode = 'ONLINE';

-- One webhook event id is stored once (a resent event is ignored).
CREATE UNIQUE INDEX webhook_events_uq ON "payment_webhook_events" (provider, event_id) WHERE event_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_links','online_orders','refunds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "payment_links", "online_orders", "refunds", "payment_webhook_events" FROM eduerp_app;
    -- Routes only map a key to an institution; they are written once and never changed.
    REVOKE UPDATE, DELETE, TRUNCATE ON "public_payment_routes" FROM eduerp_app;
  END IF;
END $$;
