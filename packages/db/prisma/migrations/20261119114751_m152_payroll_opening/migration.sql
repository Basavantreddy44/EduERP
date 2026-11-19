-- CreateTable
CREATE TABLE "payroll_tax_openings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "fy_label" VARCHAR(7) NOT NULL,
    "taxable_paid" DECIMAL(14,2) NOT NULL,
    "tds_deducted" DECIMAL(14,2) NOT NULL,
    "remarks" VARCHAR(300),
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_tax_openings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_tax_openings_tenant_id_id_key" ON "payroll_tax_openings"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_tax_openings_tenant_id_employee_id_fy_label_key" ON "payroll_tax_openings"("tenant_id", "employee_id", "fy_label");

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────
-- Salary and tax already paid earlier in a financial year (before EduERP payroll), used for TDS.
ALTER TABLE "payroll_tax_openings" ADD CONSTRAINT payroll_tax_openings_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_tax_openings" ADD CONSTRAINT payroll_tax_openings_chk CHECK (fy_label ~ '^\d{4}-\d{2}$' AND taxable_paid >= 0 AND tds_deducted >= 0);
ALTER TABLE "payroll_tax_openings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_tax_openings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_tax_openings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "payroll_tax_openings" FROM eduerp_app;
  END IF;
END $$;
