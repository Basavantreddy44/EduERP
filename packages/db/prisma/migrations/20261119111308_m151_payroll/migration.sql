-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "component_type" VARCHAR(10) NOT NULL,
    "calc_type" VARCHAR(20) NOT NULL,
    "statutory_kind" VARCHAR(5),
    "formula" VARCHAR(300),
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "affected_by_lop" BOOLEAN NOT NULL DEFAULT true,
    "is_pf_wage" BOOLEAN NOT NULL DEFAULT false,
    "account_id" UUID,
    "liability_account_id" UUID,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "designation_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structure_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "value" DECIMAL(14,2),

    CONSTRAINT "salary_structure_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "monthly_gross" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "pf_applicable" BOOLEAN NOT NULL DEFAULT true,
    "esi_applicable" BOOLEAN NOT NULL DEFAULT true,
    "pt_applicable" BOOLEAN NOT NULL DEFAULT true,
    "tds_monthly_override" DECIMAL(14,2),
    "remarks" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_salary_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "employee_salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_type" VARCHAR(20) NOT NULL,
    "state_code" VARCHAR(5),
    "slab_from" DECIMAL(14,2),
    "slab_to" DECIMAL(14,2),
    "employee_rate" DECIMAL(7,4),
    "employer_rate" DECIMAL(7,4),
    "fixed_amount" DECIMAL(14,2),
    "wage_ceiling" DECIMAL(14,2),
    "only_month" SMALLINT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "statutory_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "run_no" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prepared_by" UUID NOT NULL,
    "calculated_at" TIMESTAMPTZ(6),
    "approval_request_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "journal_entry_id" UUID,
    "paid_on" DATE,
    "paid_from_bank_account_id" UUID,
    "payment_journal_entry_id" UUID,
    "paid_by" UUID,
    "cancelled_by" UUID,
    "remarks" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "month_days" SMALLINT NOT NULL,
    "employed_days" DECIMAL(5,1) NOT NULL,
    "lop_days" DECIMAL(5,1) NOT NULL,
    "paid_days" DECIMAL(5,1) NOT NULL,
    "gross_earnings" DECIMAL(14,2) NOT NULL,
    "total_deductions" DECIMAL(14,2) NOT NULL,
    "employer_contributions" DECIMAL(14,2) NOT NULL,
    "net_pay" DECIMAL(14,2) NOT NULL,
    "pf_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_year_projected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_year" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "designation" VARCHAR(80),
    "bank_name" VARCHAR(100),
    "bank_account_last4" VARCHAR(4),
    "ifsc" VARCHAR(11),
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "component_id" UUID,
    "adjustment_id" UUID,
    "loan_id" UUID,
    "item_type" VARCHAR(10) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "payslip_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_loans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "loan_no" VARCHAR(30) NOT NULL,
    "employee_id" UUID NOT NULL,
    "loan_type" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "emi_amount" DECIMAL(14,2) NOT NULL,
    "start_month" SMALLINT NOT NULL,
    "start_year" SMALLINT NOT NULL,
    "recovered" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" VARCHAR(300) NOT NULL,
    "disbursed_on" DATE NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "bank_account_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "approval_request_id" UUID,
    "journal_entry_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_tenant_id_id_key" ON "salary_components"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_tenant_id_code_key" ON "salary_components"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_tenant_id_id_key" ON "salary_structures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_tenant_id_name_key" ON "salary_structures"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structure_items_tenant_id_id_key" ON "salary_structure_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structure_items_structure_id_component_id_key" ON "salary_structure_items"("structure_id", "component_id");

-- CreateIndex
CREATE INDEX "employee_salary_assignments_tenant_id_employee_id_effective_idx" ON "employee_salary_assignments"("tenant_id", "employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_assignments_tenant_id_id_key" ON "employee_salary_assignments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_components_tenant_id_id_key" ON "employee_salary_components"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_components_assignment_id_component_id_key" ON "employee_salary_components"("assignment_id", "component_id");

-- CreateIndex
CREATE INDEX "statutory_rules_tenant_id_rule_type_effective_from_idx" ON "statutory_rules"("tenant_id", "rule_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_rules_tenant_id_id_key" ON "statutory_rules"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payroll_runs_tenant_id_year_month_idx" ON "payroll_runs"("tenant_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_id_key" ON "payroll_runs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_run_no_key" ON "payroll_runs"("tenant_id", "run_no");

-- CreateIndex
CREATE INDEX "payslips_tenant_id_employee_id_idx" ON "payslips"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_tenant_id_id_key" ON "payslips"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "payslips"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payslip_items_tenant_id_payslip_id_idx" ON "payslip_items"("tenant_id", "payslip_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_items_tenant_id_id_key" ON "payslip_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_tenant_id_run_id_idx" ON "payroll_adjustments"("tenant_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_adjustments_tenant_id_id_key" ON "payroll_adjustments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "employee_loans_tenant_id_employee_id_status_idx" ON "employee_loans"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_loans_tenant_id_id_key" ON "employee_loans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_loans_tenant_id_loan_no_key" ON "employee_loans"("tenant_id", "loan_no");

-- AddForeignKey
ALTER TABLE "salary_structure_items" ADD CONSTRAINT "salary_structure_items_tenant_id_structure_id_fkey" FOREIGN KEY ("tenant_id", "structure_id") REFERENCES "salary_structures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_components" ADD CONSTRAINT "employee_salary_components_tenant_id_assignment_id_fkey" FOREIGN KEY ("tenant_id", "assignment_id") REFERENCES "employee_salary_assignments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "payroll_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_tenant_id_payslip_id_fkey" FOREIGN KEY ("tenant_id", "payslip_id") REFERENCES "payslips"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links.
ALTER TABLE "salary_components" ADD CONSTRAINT salary_components_account_fkey FOREIGN KEY ("tenant_id", "account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "salary_components" ADD CONSTRAINT salary_components_liability_fkey FOREIGN KEY ("tenant_id", "liability_account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "salary_structures" ADD CONSTRAINT salary_structures_designation_fkey FOREIGN KEY ("tenant_id", "designation_id") REFERENCES "designations"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "salary_structure_items" ADD CONSTRAINT salary_structure_items_component_fkey FOREIGN KEY ("tenant_id", "component_id") REFERENCES "salary_components"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_salary_assignments" ADD CONSTRAINT emp_salary_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_salary_assignments" ADD CONSTRAINT emp_salary_structure_fkey FOREIGN KEY ("tenant_id", "structure_id") REFERENCES "salary_structures"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_salary_components" ADD CONSTRAINT emp_salary_comp_component_fkey FOREIGN KEY ("tenant_id", "component_id") REFERENCES "salary_components"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT payroll_runs_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT payroll_runs_journal_fkey FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT payroll_runs_pay_journal_fkey FOREIGN KEY ("tenant_id", "payment_journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT payroll_runs_bank_fkey FOREIGN KEY ("tenant_id", "paid_from_bank_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT payslips_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT payslips_assignment_fkey FOREIGN KEY ("tenant_id", "assignment_id") REFERENCES "employee_salary_assignments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payslip_items" ADD CONSTRAINT payslip_items_component_fkey FOREIGN KEY ("tenant_id", "component_id") REFERENCES "salary_components"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payslip_items" ADD CONSTRAINT payslip_items_loan_fkey FOREIGN KEY ("tenant_id", "loan_id") REFERENCES "employee_loans"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT payroll_adj_run_fkey FOREIGN KEY ("tenant_id", "run_id") REFERENCES "payroll_runs"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT payroll_adj_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_loans" ADD CONSTRAINT employee_loans_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_loans" ADD CONSTRAINT employee_loans_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_loans" ADD CONSTRAINT employee_loans_bank_fkey FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_loans" ADD CONSTRAINT employee_loans_journal_fkey FOREIGN KEY ("tenant_id", "journal_entry_id") REFERENCES "journal_entries"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "salary_components" ADD CONSTRAINT salary_components_chk CHECK (
  component_type IN ('EARNING','DEDUCTION','EMPLOYER')
  AND calc_type IN ('FIXED','PERCENT_OF_BASIC','PERCENT_OF_GROSS','BALANCE','FORMULA','STATUTORY')
  AND (calc_type = 'STATUTORY') = (statutory_kind IS NOT NULL)
  AND (statutory_kind IS NULL OR statutory_kind IN ('PF','ESI','PT','TDS','LOAN'))
  AND (calc_type <> 'FORMULA' OR formula IS NOT NULL)
  AND (calc_type <> 'BALANCE' OR component_type = 'EARNING')
  AND (component_type <> 'EMPLOYER' OR statutory_kind IN ('PF','ESI'))
  AND code ~ '^[A-Z][A-Z0-9_]*$');
-- At most one "balance of gross" component in a structure is enforced by the service; values are never negative.
ALTER TABLE "salary_structure_items" ADD CONSTRAINT salary_structure_items_chk CHECK (value IS NULL OR value >= 0);
ALTER TABLE "employee_salary_assignments" ADD CONSTRAINT emp_salary_chk CHECK (monthly_gross > 0 AND (effective_to IS NULL OR effective_to >= effective_from) AND (tds_monthly_override IS NULL OR tds_monthly_override >= 0));
-- One open salary per person.
CREATE UNIQUE INDEX emp_salary_open_uq ON "employee_salary_assignments" ("tenant_id", "employee_id") WHERE effective_to IS NULL;
ALTER TABLE "employee_salary_components" ADD CONSTRAINT emp_salary_comp_chk CHECK (value >= 0);
ALTER TABLE "statutory_rules" ADD CONSTRAINT statutory_rules_chk CHECK (
  rule_type IN ('PF','ESI','PT','TDS','TDS_STD_DEDUCTION','TDS_REBATE','TDS_CESS')
  AND (effective_to IS NULL OR effective_to >= effective_from)
  AND (only_month IS NULL OR only_month BETWEEN 1 AND 12)
  AND (slab_to IS NULL OR slab_from IS NULL OR slab_to >= slab_from)
  AND (employee_rate IS NULL OR employee_rate BETWEEN 0 AND 100) AND (employer_rate IS NULL OR employer_rate BETWEEN 0 AND 100)
  AND (fixed_amount IS NULL OR fixed_amount >= 0) AND (wage_ceiling IS NULL OR wage_ceiling >= 0));
ALTER TABLE "payroll_runs" ADD CONSTRAINT payroll_runs_chk CHECK (
  month BETWEEN 1 AND 12 AND year BETWEEN 2000 AND 2100
  AND status IN ('DRAFT','CALCULATED','PENDING_APPROVAL','APPROVED','PAID','CANCELLED')
  AND (status NOT IN ('APPROVED','PAID') OR journal_entry_id IS NOT NULL)
  AND (status <> 'PAID' OR (payment_journal_entry_id IS NOT NULL AND paid_on IS NOT NULL))
  AND total_gross >= 0 AND total_deductions >= 0 AND total_net >= 0 AND total_employer >= 0);
-- One live run per campus and month (a cancelled run frees the month).
CREATE UNIQUE INDEX payroll_runs_month_uq ON "payroll_runs" ("tenant_id", "campus_id", "year", "month") WHERE status <> 'CANCELLED';
ALTER TABLE "payslips" ADD CONSTRAINT payslips_chk CHECK (
  month_days BETWEEN 28 AND 31 AND employed_days BETWEEN 0 AND month_days AND lop_days >= 0 AND paid_days >= 0 AND paid_days = employed_days - lop_days
  AND gross_earnings >= 0 AND total_deductions >= 0 AND employer_contributions >= 0 AND net_pay >= 0 AND net_pay = gross_earnings - total_deductions);
ALTER TABLE "payslip_items" ADD CONSTRAINT payslip_items_chk CHECK (item_type IN ('EARNING','DEDUCTION','EMPLOYER') AND amount >= 0);
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT payroll_adj_chk CHECK (item_type IN ('EARNING','DEDUCTION') AND amount > 0);
ALTER TABLE "employee_loans" ADD CONSTRAINT employee_loans_chk CHECK (
  loan_type IN ('ADVANCE','LOAN') AND amount > 0 AND emi_amount > 0 AND emi_amount <= amount
  AND recovered >= 0 AND recovered <= amount AND start_month BETWEEN 1 AND 12
  AND mode IN ('CASH','CHEQUE','NEFT','RTGS','UPI') AND (mode = 'CASH') = (bank_account_id IS NULL)
  AND status IN ('PENDING_APPROVAL','ACTIVE','CLOSED','REJECTED','CANCELLED')
  AND (status <> 'CLOSED' OR recovered = amount));

-- Payslips are frozen once their run is submitted: only "released" may change after that.
CREATE OR REPLACE FUNCTION payslip_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; rid uuid;
BEGIN
  IF TG_TABLE_NAME = 'payslips' THEN
    rid := COALESCE(NEW.run_id, OLD.run_id);
  ELSE
    SELECT run_id INTO rid FROM payslips WHERE id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  END IF;
  SELECT status INTO st FROM payroll_runs WHERE id = rid;
  IF st IN ('PENDING_APPROVAL','APPROVED','PAID') THEN
    IF TG_TABLE_NAME = 'payslips' AND TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'is_released') = (to_jsonb(OLD) - 'is_released') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Payslips of a submitted payroll run cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER payslips_frozen BEFORE INSERT OR UPDATE OR DELETE ON "payslips" FOR EACH ROW EXECUTE FUNCTION payslip_frozen();
CREATE TRIGGER payslip_items_frozen BEFORE INSERT OR UPDATE OR DELETE ON "payslip_items" FOR EACH ROW EXECUTE FUNCTION payslip_frozen();

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salary_components','salary_structures','salary_structure_items','employee_salary_assignments','employee_salary_components','statutory_rules','payroll_runs','payslips','payslip_items','payroll_adjustments','employee_loans'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Payroll records are never deleted. Structure lines, personal values, one-off lines and the payslips of a
-- run still being prepared may be removed (the frozen trigger guards submitted runs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "salary_components", "salary_structures", "employee_salary_assignments", "statutory_rules", "payroll_runs", "employee_loans" FROM eduerp_app;
    REVOKE TRUNCATE ON "salary_structure_items", "employee_salary_components", "payslips", "payslip_items", "payroll_adjustments" FROM eduerp_app;
  END IF;
END $$;
