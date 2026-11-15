




-- AlterTable
ALTER TABLE "outbox_events" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "processed_events" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "dept_type" VARCHAR(20) NOT NULL,
    "head_employee_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "holiday_date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "holiday_type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "purpose" VARCHAR(20) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(300),
    "price_per_student" DECIMAL(10,2) NOT NULL,
    "billing_cycle" VARCHAR(10) NOT NULL,
    "max_students" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_modules" (
    "plan_id" UUID NOT NULL,
    "module_code" VARCHAR(40) NOT NULL,

    CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("plan_id","module_code")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "student_count" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module_code" VARCHAR(40) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL,
    "source" VARCHAR(10) NOT NULL DEFAULT 'PLAN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_tenant_id_id_key" ON "academic_years"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_tenant_id_name_key" ON "academic_years"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_id_key" ON "departments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "holidays_tenant_id_holiday_date_idx" ON "holidays"("tenant_id", "holiday_date");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_purpose_created_at_idx" ON "auth_tokens"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_tenant_id_status_idx" ON "tenant_subscriptions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_code_key" ON "tenant_modules"("tenant_id", "module_code");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ---------- Platform-level events (account emails) ----------
-- Tenants still cannot see or write NULL-tenant rows. Only auth.* events may be written without a tenant,
-- and only the system worker reads or processes them.
CREATE POLICY outbox_platform_insert ON "outbox_events" FOR INSERT
  WITH CHECK (tenant_id IS NULL AND event_type LIKE 'auth.%');
CREATE POLICY processed_events_system ON "processed_events"
  USING (tenant_id IS NULL AND app_is_system()) WITH CHECK (tenant_id IS NULL AND app_is_system());

-- ---------- Academic setup ----------
ALTER TABLE "academic_years" ADD CONSTRAINT academic_years_dates_chk CHECK (end_date > start_date);
ALTER TABLE "academic_years" ADD CONSTRAINT academic_years_status_chk CHECK (status IN ('PLANNING','ACTIVE','CLOSED'));
-- Only one current academic year per institution.
CREATE UNIQUE INDEX academic_years_current_uq ON "academic_years" (tenant_id) WHERE is_current;

ALTER TABLE "departments" ADD CONSTRAINT departments_type_chk CHECK (dept_type IN ('ACADEMIC','ADMIN','SUPPORT'));
ALTER TABLE "departments" ADD CONSTRAINT departments_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
CREATE UNIQUE INDEX departments_code_uq ON "departments" (tenant_id, campus_id, code) NULLS NOT DISTINCT;

ALTER TABLE "holidays" ADD CONSTRAINT holidays_type_chk CHECK (holiday_type IN ('PUBLIC','INSTITUTION','EXAM_BREAK'));
CREATE UNIQUE INDEX holidays_date_uq ON "holidays" (tenant_id, campus_id, holiday_date) NULLS NOT DISTINCT;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_years','departments','holidays'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- ---------- Account links ----------
ALTER TABLE "auth_tokens" ADD CONSTRAINT auth_tokens_purpose_chk CHECK (purpose IN ('INVITE','RESET'));

-- ---------- Plans & entitlements ----------
ALTER TABLE "plans" ADD CONSTRAINT plans_cycle_chk CHECK (billing_cycle IN ('MONTHLY','YEARLY'));
ALTER TABLE "plans" ADD CONSTRAINT plans_price_chk CHECK (price_per_student >= 0);
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT tenant_subscriptions_status_chk CHECK (status IN ('TRIAL','ACTIVE','EXPIRED','CANCELLED'));
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT tenant_subscriptions_dates_chk CHECK (end_date >= start_date);
ALTER TABLE "tenant_modules" ADD CONSTRAINT tenant_modules_source_chk CHECK (source IN ('PLAN','OVERRIDE','CORE'));
-- One live subscription per institution.
CREATE UNIQUE INDEX tenant_subscriptions_live_uq ON "tenant_subscriptions" (tenant_id) WHERE status IN ('TRIAL','ACTIVE');

-- Plan catalogue: everyone may read; only platform staff change it.
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON "plans" FOR SELECT USING (true);
CREATE POLICY plans_write ON "plans" FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
ALTER TABLE "plan_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_modules" FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_modules_read ON "plan_modules" FOR SELECT USING (true);
CREATE POLICY plan_modules_write ON "plan_modules" FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());

-- Subscriptions and module switches: an institution reads its own; only platform staff change them.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_subscriptions','tenant_modules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = app_current_tenant() OR app_is_platform())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform())', t || '_write', t);
  END LOOP;
END $$;

-- ---------- Runtime-role privileges ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "auth_tokens", "academic_years", "tenant_subscriptions" FROM eduerp_app;
  END IF;
END $$;
