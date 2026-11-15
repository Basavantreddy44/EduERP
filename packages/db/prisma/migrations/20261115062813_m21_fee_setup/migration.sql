







-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "account_type" VARCHAR(20) NOT NULL,
    "parent_id" UUID,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_key" VARCHAR(30),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_heads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "fee_type" VARCHAR(20) NOT NULL,
    "income_account_id" UUID NOT NULL,
    "is_refundable" BOOLEAN NOT NULL DEFAULT false,
    "gst_applicable" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "fee_group" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revision_of_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "activated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_instalments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "instalment_no" SMALLINT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "due_date" DATE NOT NULL,

    CONSTRAINT "fee_structure_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "fee_head_id" UUID NOT NULL,
    "instalment_no" SMALLINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "fee_structure_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fee_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "campus_id" UUID,
    "fee_head_id" UUID,
    "grace_days" SMALLINT NOT NULL,
    "fine_type" VARCHAR(10) NOT NULL,
    "fine_value" DECIMAL(14,2) NOT NULL,
    "max_fine" DECIMAL(14,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "late_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_tenant_id_id_key" ON "financial_years"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_tenant_id_name_key" ON "financial_years"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_id_key" ON "accounts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_system_key_key" ON "accounts"("tenant_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "fee_heads_tenant_id_id_key" ON "fee_heads"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_heads_tenant_id_code_key" ON "fee_heads"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "fee_structures_tenant_id_academic_year_id_program_level_id__idx" ON "fee_structures"("tenant_id", "academic_year_id", "program_level_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_tenant_id_id_key" ON "fee_structures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_instalments_tenant_id_id_key" ON "fee_structure_instalments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_instalments_fee_structure_id_instalment_no_key" ON "fee_structure_instalments"("fee_structure_id", "instalment_no");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_items_tenant_id_id_key" ON "fee_structure_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_items_fee_structure_id_fee_head_id_instalment_key" ON "fee_structure_items"("fee_structure_id", "fee_head_id", "instalment_no");

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_rules_tenant_id_id_key" ON "late_fee_rules"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_tenant_id_income_account_id_fkey" FOREIGN KEY ("tenant_id", "income_account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_program_level_id_fkey" FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_revision_of_id_fkey" FOREIGN KEY ("tenant_id", "revision_of_id") REFERENCES "fee_structures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_instalments" ADD CONSTRAINT "fee_structure_instalments_tenant_id_fee_structure_id_fkey" FOREIGN KEY ("tenant_id", "fee_structure_id") REFERENCES "fee_structures"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_tenant_id_fee_structure_id_fkey" FOREIGN KEY ("tenant_id", "fee_structure_id") REFERENCES "fee_structures"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_tenant_id_fee_head_id_fkey" FOREIGN KEY ("tenant_id", "fee_head_id") REFERENCES "fee_heads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_tenant_id_fee_head_id_fkey" FOREIGN KEY ("tenant_id", "fee_head_id") REFERENCES "fee_heads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "financial_years" ADD CONSTRAINT financial_years_dates_chk CHECK (end_date > start_date);
ALTER TABLE "accounts" ADD CONSTRAINT accounts_type_chk CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'));
ALTER TABLE "fee_heads" ADD CONSTRAINT fee_heads_type_chk CHECK (fee_type IN ('ACADEMIC','ADMISSION','EXAM','TRANSPORT','HOSTEL','MESS','DEPOSIT','FINE','OTHER'));
ALTER TABLE "fee_heads" ADD CONSTRAINT fee_heads_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "fee_structures" ADD CONSTRAINT fee_structures_status_chk CHECK (status IN ('DRAFT','ACTIVE','CLOSED'));
ALTER TABLE "fee_structures" ADD CONSTRAINT fee_structures_total_chk CHECK (total_amount >= 0);
ALTER TABLE "fee_structure_instalments" ADD CONSTRAINT fee_instalments_no_chk CHECK (instalment_no BETWEEN 1 AND 12);
ALTER TABLE "fee_structure_items" ADD CONSTRAINT fee_items_amount_chk CHECK (amount >= 0);
ALTER TABLE "fee_structure_items" ADD CONSTRAINT fee_items_no_chk CHECK (instalment_no BETWEEN 1 AND 12);
ALTER TABLE "late_fee_rules" ADD CONSTRAINT late_fee_type_chk CHECK (fine_type IN ('FIXED','PER_DAY','PERCENT'));
ALTER TABLE "late_fee_rules" ADD CONSTRAINT late_fee_values_chk CHECK (fine_value > 0 AND (fine_type <> 'PERCENT' OR fine_value <= 100) AND (max_fine IS NULL OR max_fine > 0) AND grace_days >= 0);
ALTER TABLE "late_fee_rules" ADD CONSTRAINT late_fee_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));

-- One active structure per class, year and fee group.
CREATE UNIQUE INDEX fee_structures_active_uq ON "fee_structures" (tenant_id, academic_year_id, program_level_id, lower(coalesce(fee_group, ''))) WHERE status = 'ACTIVE';

-- Amounts of an active or closed structure never change (bills are made from them): revise instead.
CREATE OR REPLACE FUNCTION fee_structure_lines_locked() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM fee_structures WHERE id = COALESCE(NEW.fee_structure_id, OLD.fee_structure_id);
  IF s IS NOT NULL AND s <> 'DRAFT' THEN
    RAISE EXCEPTION 'fee_structure_locked: a % structure cannot be changed', lower(s) USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER fee_items_locked_trg BEFORE INSERT OR UPDATE OR DELETE ON "fee_structure_items" FOR EACH ROW EXECUTE FUNCTION fee_structure_lines_locked();
CREATE TRIGGER fee_instalments_locked_trg BEFORE INSERT OR UPDATE OR DELETE ON "fee_structure_instalments" FOR EACH ROW EXECUTE FUNCTION fee_structure_lines_locked();

-- Structure: only DRAFT → ACTIVE → CLOSED; placement and amounts fixed once active; only drafts are deleted.
CREATE OR REPLACE FUNCTION fee_structures_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'fee_structure_locked: only a draft can be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF NOT ((OLD.status = 'ACTIVE' AND NEW.status IN ('ACTIVE','CLOSED')) OR (OLD.status = 'CLOSED' AND NEW.status = 'CLOSED')) THEN
      RAISE EXCEPTION 'fee_structure_locked: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.total_amount <> OLD.total_amount OR NEW.program_level_id <> OLD.program_level_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.campus_id <> OLD.campus_id OR coalesce(NEW.fee_group, '') <> coalesce(OLD.fee_group, '') THEN
      RAISE EXCEPTION 'fee_structure_locked: an active structure keeps its class, year, group and amounts' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'CLOSED' THEN
    RAISE EXCEPTION 'fee_structure_locked: a draft is deleted, not closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_structures_guard_trg BEFORE UPDATE OR DELETE ON "fee_structures" FOR EACH ROW EXECUTE FUNCTION fee_structures_guard();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_years','accounts','fee_heads','fee_structures','fee_structure_instalments','fee_structure_items','late_fee_rules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Accounts, years and fee heads are deactivated, never deleted (postings will point at them).
    REVOKE DELETE, TRUNCATE ON "financial_years", "accounts", "fee_heads", "late_fee_rules" FROM eduerp_app;
  END IF;
END $$;
