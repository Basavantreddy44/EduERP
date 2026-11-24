
-- AlterTable
ALTER TABLE "campuses" ADD COLUMN     "ddo_code" VARCHAR(20);

-- AlterTable
ALTER TABLE "employee_details" ADD COLUMN     "govt_employment" VARCHAR(12),
ADD COLUMN     "govt_service_date" DATE,
ADD COLUMN     "gpf_no" VARCHAR(30),
ADD COLUMN     "hrms_id" VARCHAR(20),
ADD COLUMN     "kgid_no" VARCHAR(20),
ADD COLUMN     "pay_scale" VARCHAR(60),
ADD COLUMN     "pran_no" VARCHAR(12);

-- CreateTable
CREATE TABLE "student_gov_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "sats_id" VARCHAR(20),
    "pen_no" VARCHAR(20),
    "ration_card_type" VARCHAR(5),
    "is_ews" BOOLEAN,
    "minority_group" VARCHAR(20),
    "is_cwsn" BOOLEAN NOT NULL DEFAULT false,
    "disability_type" VARCHAR(60),
    "medium_of_instruction" VARCHAR(20),
    "distance_km" DECIMAL(6,1),
    "previous_school" VARCHAR(200),
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_gov_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gov_export_layouts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "export_code" VARCHAR(10) NOT NULL,
    "columns" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gov_export_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welfare_schemes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(5) NOT NULL,
    "inventory_item_id" UUID,
    "quantity_per_student" DECIMAL(10,2),
    "amount_per_student" DECIMAL(12,2),
    "level_names" VARCHAR(50)[],
    "gender" VARCHAR(6) NOT NULL DEFAULT 'ALL',
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "welfare_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welfare_distributions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "given_on" DATE NOT NULL,
    "quantity" DECIMAL(10,2),
    "amount" DECIMAL(12,2),
    "store_id" UUID,
    "reference" VARCHAR(60),
    "remarks" VARCHAR(200),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "welfare_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_scale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "quantity_per_child" DECIMAL(10,3) NOT NULL,
    "level_names" VARCHAR(50)[],
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "diet_scale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_counts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "meal_date" DATE NOT NULL,
    "level_name" VARCHAR(50) NOT NULL,
    "breakfast" INTEGER NOT NULL DEFAULT 0,
    "lunch" INTEGER NOT NULL DEFAULT 0,
    "snacks" INTEGER NOT NULL DEFAULT 0,
    "dinner" INTEGER NOT NULL DEFAULT 0,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meal_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_gov_profiles_tenant_id_id_key" ON "student_gov_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "student_gov_profiles_tenant_id_student_id_key" ON "student_gov_profiles"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "gov_export_layouts_tenant_id_export_code_key" ON "gov_export_layouts"("tenant_id", "export_code");

-- CreateIndex
CREATE UNIQUE INDEX "welfare_schemes_tenant_id_id_key" ON "welfare_schemes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "welfare_schemes_tenant_id_academic_year_id_name_key" ON "welfare_schemes"("tenant_id", "academic_year_id", "name");

-- CreateIndex
CREATE INDEX "welfare_distributions_tenant_id_scheme_id_student_id_idx" ON "welfare_distributions"("tenant_id", "scheme_id", "student_id");

-- CreateIndex
CREATE INDEX "welfare_distributions_tenant_id_student_id_idx" ON "welfare_distributions"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "welfare_distributions_tenant_id_id_key" ON "welfare_distributions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "diet_scale_items_tenant_id_inventory_item_id_idx" ON "diet_scale_items"("tenant_id", "inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "diet_scale_items_tenant_id_id_key" ON "diet_scale_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "meal_counts_tenant_id_campus_id_meal_date_idx" ON "meal_counts"("tenant_id", "campus_id", "meal_date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_counts_tenant_id_id_key" ON "meal_counts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_counts_tenant_id_campus_id_meal_date_level_name_key" ON "meal_counts"("tenant_id", "campus_id", "meal_date", "level_name");

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ───────────── Hand-written section (improvement round G1–G5) ─────────────
-- Class lists default to empty (= all classes).
ALTER TABLE "welfare_schemes" ALTER COLUMN "level_names" SET DEFAULT '{}', ALTER COLUMN "level_names" SET NOT NULL;
ALTER TABLE "diet_scale_items" ALTER COLUMN "level_names" SET DEFAULT '{}', ALTER COLUMN "level_names" SET NOT NULL;

-- Foreign keys (composite with tenant, as everywhere).
ALTER TABLE "student_gov_profiles" ADD CONSTRAINT gov_profiles_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "welfare_schemes" ADD CONSTRAINT welfare_schemes_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "welfare_schemes" ADD CONSTRAINT welfare_schemes_item_fkey FOREIGN KEY ("tenant_id", "inventory_item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "welfare_distributions" ADD CONSTRAINT welfare_dist_scheme_fkey FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "welfare_schemes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "welfare_distributions" ADD CONSTRAINT welfare_dist_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "welfare_distributions" ADD CONSTRAINT welfare_dist_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "welfare_distributions" ADD CONSTRAINT welfare_dist_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "diet_scale_items" ADD CONSTRAINT diet_scale_item_fkey FOREIGN KEY ("tenant_id", "inventory_item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "meal_counts" ADD CONSTRAINT meal_counts_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "employee_details" ADD CONSTRAINT employee_details_govt_chk CHECK (govt_employment IS NULL OR govt_employment IN ('GOVERNMENT','OUTSOURCED','GUEST','PRIVATE'));
ALTER TABLE "student_gov_profiles" ADD CONSTRAINT gov_profiles_chk CHECK (
  (ration_card_type IS NULL OR ration_card_type IN ('APL','BPL','AAY','NONE'))
  AND (distance_km IS NULL OR distance_km >= 0) AND (is_cwsn OR disability_type IS NULL));
ALTER TABLE "gov_export_layouts" ADD CONSTRAINT gov_layouts_chk CHECK (export_code IN ('SATS','UDISE') AND jsonb_typeof(columns) = 'array');
-- An item scheme has its quantity (and may name a store item); a cash scheme its amount.
ALTER TABLE "welfare_schemes" ADD CONSTRAINT welfare_schemes_chk CHECK (
  kind IN ('ITEM','CASH') AND gender IN ('ALL','MALE','FEMALE') AND status IN ('ACTIVE','CLOSED')
  AND (kind <> 'ITEM' OR (quantity_per_student > 0 AND amount_per_student IS NULL))
  AND (kind <> 'CASH' OR (amount_per_student > 0 AND quantity_per_student IS NULL AND inventory_item_id IS NULL)));
ALTER TABLE "welfare_distributions" ADD CONSTRAINT welfare_dist_chk CHECK (
  ((quantity IS NOT NULL AND quantity > 0 AND amount IS NULL) OR (amount IS NOT NULL AND amount > 0 AND quantity IS NULL AND reference IS NOT NULL)));
ALTER TABLE "diet_scale_items" ADD CONSTRAINT diet_scale_chk CHECK (quantity_per_child > 0 AND (effective_to IS NULL OR effective_to >= effective_from));
ALTER TABLE "meal_counts" ADD CONSTRAINT meal_counts_chk CHECK (breakfast >= 0 AND lunch >= 0 AND snacks >= 0 AND dinner >= 0);
-- Welfare hand-outs leave the store as a welfare movement in the item ledger.
ALTER TABLE "stock_transactions" DROP CONSTRAINT stock_txn_chk;
ALTER TABLE "stock_transactions" ADD CONSTRAINT stock_txn_chk CHECK (
  txn_type IN ('OPENING','GRN_IN','ISSUE_OUT','TRANSFER_OUT','TRANSFER_IN','ADJUST_IN','ADJUST_OUT')
  AND reference_type IN ('OPENING','GRN','ISSUE','TRANSFER','COUNT','WELFARE')
  AND quantity > 0 AND rate >= 0 AND value >= 0 AND balance_after >= 0 AND value_after >= 0);

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_gov_profiles','gov_export_layouts','welfare_schemes','welfare_distributions','diet_scale_items','meal_counts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Hand-outs and schemes are kept (schemes are closed); layouts, scale lines and meal counts may be removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "welfare_schemes", "welfare_distributions", "student_gov_profiles" FROM eduerp_app;
  END IF;
END $$;
