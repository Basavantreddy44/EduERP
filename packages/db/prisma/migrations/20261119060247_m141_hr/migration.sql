-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "designation_id" UUID;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "carry_forward_max" DECIMAL(5,1);

-- AlterTable
ALTER TABLE "staff_attendance" ADD COLUMN     "late_minutes" SMALLINT;

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_details" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "father_or_spouse_name" VARCHAR(150),
    "marital_status" VARCHAR(10),
    "blood_group" VARCHAR(3),
    "permanent_address" VARCHAR(500),
    "current_address" VARCHAR(500),
    "emergency_contact_name" VARCHAR(150),
    "emergency_contact_phone" VARCHAR(15),
    "pan_enc" VARCHAR(200),
    "pan_last4" VARCHAR(4),
    "aadhaar_last4" VARCHAR(4),
    "uan_no" VARCHAR(12),
    "pf_no" VARCHAR(30),
    "esi_no" VARCHAR(17),
    "bank_name" VARCHAR(100),
    "bank_account_enc" VARCHAR(200),
    "bank_account_last4" VARCHAR(4),
    "ifsc" VARCHAR(11),
    "shift_id" UUID,
    "reporting_to_id" UUID,
    "confirmation_date" DATE,
    "probation_end_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "employee_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_qualifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "qualification" VARCHAR(100) NOT NULL,
    "institution" VARCHAR(200) NOT NULL,
    "year_of_passing" SMALLINT NOT NULL,
    "percentage" DECIMAL(5,2),
    "certificate_file_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_experiences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "organisation" VARCHAR(200) NOT NULL,
    "designation" VARCHAR(100) NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "late_after_minutes" SMALLINT NOT NULL,
    "half_day_after_minutes" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balance_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "kind" VARCHAR(15) NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_exits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "exit_type" VARCHAR(15) NOT NULL,
    "resignation_date" DATE NOT NULL,
    "last_working_date" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "handover_to_id" UUID,
    "settlement_amount" DECIMAL(14,2),
    "status" VARCHAR(15) NOT NULL,
    "remarks" VARCHAR(300),
    "initiated_by" UUID NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_clearances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exit_id" UUID NOT NULL,
    "section" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "due_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" VARCHAR(300),
    "cleared_by" UUID,
    "cleared_at" TIMESTAMPTZ(6),

    CONSTRAINT "exit_clearances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "designations_tenant_id_id_key" ON "designations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "designations_tenant_id_code_key" ON "designations"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "designations_tenant_id_name_key" ON "designations"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "employee_details_tenant_id_shift_id_idx" ON "employee_details"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_details_tenant_id_id_key" ON "employee_details"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_details_tenant_id_employee_id_key" ON "employee_details"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_qualifications_tenant_id_employee_id_idx" ON "employee_qualifications"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_qualifications_tenant_id_id_key" ON "employee_qualifications"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "employee_experiences_tenant_id_employee_id_idx" ON "employee_experiences"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_experiences_tenant_id_id_key" ON "employee_experiences"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_id_key" ON "shifts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_campus_id_name_key" ON "shifts"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE INDEX "leave_balance_adjustments_tenant_id_employee_id_leave_type__idx" ON "leave_balance_adjustments"("tenant_id", "employee_id", "leave_type_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balance_adjustments_tenant_id_id_key" ON "leave_balance_adjustments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "employee_exits_tenant_id_status_idx" ON "employee_exits"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_exits_tenant_id_id_key" ON "employee_exits"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exit_clearances_tenant_id_id_key" ON "exit_clearances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exit_clearances_exit_id_section_key" ON "exit_clearances"("exit_id", "section");

-- AddForeignKey
ALTER TABLE "exit_clearances" ADD CONSTRAINT "exit_clearances_tenant_id_exit_id_fkey" FOREIGN KEY ("tenant_id", "exit_id") REFERENCES "employee_exits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Designations: existing free-text designations become designation rows (per institution) and are linked.
INSERT INTO designations (id, tenant_id, code, name, category, is_active, created_at)
SELECT gen_random_uuid(), x.tenant_id,
       left(regexp_replace(upper(x.designation), '[^A-Z0-9]+', '-', 'g'), 16) || '-' || lpad((row_number() OVER (PARTITION BY x.tenant_id ORDER BY x.designation))::text, 3, '0'),
       x.designation, CASE WHEN x.types LIKE '%TEACHING%' AND x.types NOT LIKE '%NON_TEACHING%' THEN 'TEACHING' ELSE 'NON_TEACHING' END, true, now()
  FROM (SELECT tenant_id, trim(designation) AS designation, string_agg(DISTINCT employee_type, ',') AS types FROM employees WHERE designation IS NOT NULL AND trim(designation) <> '' GROUP BY tenant_id, trim(designation)) x;
UPDATE employees e SET designation_id = d.id FROM designations d WHERE d.tenant_id = e.tenant_id AND d.name = trim(e.designation) AND e.designation_id IS NULL;

-- Tenant-safe links.
ALTER TABLE "employees" ADD CONSTRAINT employees_designation_fkey FOREIGN KEY ("tenant_id", "designation_id") REFERENCES "designations"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_details" ADD CONSTRAINT employee_details_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_details" ADD CONSTRAINT employee_details_shift_fkey FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shifts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_details" ADD CONSTRAINT employee_details_reporting_fkey FOREIGN KEY ("tenant_id", "reporting_to_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_qualifications" ADD CONSTRAINT employee_quals_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_experiences" ADD CONSTRAINT employee_exps_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "shifts" ADD CONSTRAINT shifts_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT leave_adj_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT leave_adj_type_fkey FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_types"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT leave_adj_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_exits" ADD CONSTRAINT employee_exits_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_exits" ADD CONSTRAINT employee_exits_handover_fkey FOREIGN KEY ("tenant_id", "handover_to_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes. Aadhaar: last 4 digits only; PAN / bank number: only encrypted (CD-84).
ALTER TABLE "designations" ADD CONSTRAINT designations_category_chk CHECK (category IN ('TEACHING','NON_TEACHING','ADMIN','SUPPORT'));
ALTER TABLE "employee_details" ADD CONSTRAINT employee_details_chk CHECK (
  (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^\d{4}$')
  AND (pan_enc IS NULL OR pan_enc LIKE 'v1:%') AND (bank_account_enc IS NULL OR bank_account_enc LIKE 'v1:%')
  AND (pan_enc IS NULL) = (pan_last4 IS NULL) AND (bank_account_enc IS NULL) = (bank_account_last4 IS NULL)
  AND (marital_status IS NULL OR marital_status IN ('SINGLE','MARRIED','WIDOWED','DIVORCED','SEPARATED'))
  AND (blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'))
  AND (uan_no IS NULL OR uan_no ~ '^\d{12}$')
  AND (reporting_to_id IS NULL OR reporting_to_id <> employee_id));
ALTER TABLE "employee_qualifications" ADD CONSTRAINT employee_quals_chk CHECK (year_of_passing BETWEEN 1950 AND 2100 AND (percentage IS NULL OR percentage BETWEEN 0 AND 100));
ALTER TABLE "employee_experiences" ADD CONSTRAINT employee_exps_chk CHECK (to_date >= from_date);
ALTER TABLE "shifts" ADD CONSTRAINT shifts_chk CHECK (start_time ~ '^\d{2}:\d{2}$' AND end_time ~ '^\d{2}:\d{2}$' AND end_time > start_time AND late_after_minutes >= 0 AND half_day_after_minutes > late_after_minutes);
ALTER TABLE "staff_attendance" ADD CONSTRAINT staff_attendance_late_chk CHECK (late_minutes IS NULL OR late_minutes >= 0);
ALTER TABLE "leave_types" ADD CONSTRAINT leave_types_carry_chk CHECK (carry_forward_max IS NULL OR carry_forward_max >= 0);
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT leave_adj_chk CHECK (kind IN ('OPENING','CARRY_FORWARD','ENCASHMENT','ADJUSTMENT') AND days <> 0 AND (kind <> 'ENCASHMENT' OR days < 0) AND (kind NOT IN ('OPENING','CARRY_FORWARD') OR days > 0));
-- One carry-forward per person, type and year (the year-end run is safe to repeat).
CREATE UNIQUE INDEX leave_adj_carry_uq ON "leave_balance_adjustments" ("tenant_id", "employee_id", "leave_type_id", "academic_year_id") WHERE kind = 'CARRY_FORWARD';
ALTER TABLE "employee_exits" ADD CONSTRAINT employee_exits_chk CHECK (exit_type IN ('RESIGNATION','RETIREMENT','TERMINATION','CONTRACT_END','DEATH') AND status IN ('INITIATED','CLOSED','CANCELLED') AND last_working_date >= resignation_date AND (status <> 'CLOSED' OR closed_at IS NOT NULL));
-- One open exit per person.
CREATE UNIQUE INDEX employee_exits_open_uq ON "employee_exits" ("tenant_id", "employee_id") WHERE status = 'INITIATED';
ALTER TABLE "exit_clearances" ADD CONSTRAINT exit_clearances_chk CHECK (section IN ('LIBRARY','STORE','ACCOUNTS','HOSTEL','IT','ADMIN') AND status IN ('PENDING','CLEARED') AND due_amount >= 0 AND (status <> 'CLEARED' OR cleared_at IS NOT NULL));

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['designations','employee_details','employee_qualifications','employee_experiences','shifts','leave_balance_adjustments','employee_exits','exit_clearances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- HR records are never deleted (qualifications / experience rows may be removed by HR when entered wrongly).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "designations", "employee_details", "shifts", "leave_balance_adjustments", "employee_exits", "exit_clearances" FROM eduerp_app;
    REVOKE TRUNCATE ON "employee_qualifications", "employee_experiences" FROM eduerp_app;
  END IF;
END $$;
