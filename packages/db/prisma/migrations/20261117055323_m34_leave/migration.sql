







-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "applies_to" VARCHAR(10) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "days_per_year" DECIMAL(5,1),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "applicant_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "leave_type_id" UUID NOT NULL,
    "academic_year_id" UUID,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "applied_by" UUID NOT NULL,
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_remarks" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "check_in" VARCHAR(5),
    "check_out" VARCHAR(5),
    "remarks" VARCHAR(200),
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "marked_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenant_id_id_key" ON "leave_types"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenant_id_applies_to_code_key" ON "leave_types"("tenant_id", "applies_to", "code");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_status_from_date_idx" ON "leave_requests"("tenant_id", "status", "from_date");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_student_id_from_date_idx" ON "leave_requests"("tenant_id", "student_id", "from_date");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_employee_id_from_date_idx" ON "leave_requests"("tenant_id", "employee_id", "from_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_tenant_id_id_key" ON "leave_requests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "staff_attendance_tenant_id_campus_id_attendance_date_idx" ON "staff_attendance"("tenant_id", "campus_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_tenant_id_employee_id_attendance_date_key" ON "staff_attendance"("tenant_id", "employee_id", "attendance_date");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_leave_type_id_fkey" FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "leave_types" ADD CONSTRAINT leave_types_applies_chk CHECK (applies_to IN ('STUDENT','EMPLOYEE'));
ALTER TABLE "leave_types" ADD CONSTRAINT leave_types_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "leave_types" ADD CONSTRAINT leave_types_days_chk CHECK (days_per_year IS NULL OR days_per_year > 0);

ALTER TABLE "leave_requests" ADD CONSTRAINT leave_req_applicant_chk CHECK (
  (applicant_type = 'STUDENT' AND student_id IS NOT NULL AND employee_id IS NULL) OR
  (applicant_type = 'EMPLOYEE' AND employee_id IS NOT NULL AND student_id IS NULL));
ALTER TABLE "leave_requests" ADD CONSTRAINT leave_req_dates_chk CHECK (to_date >= from_date AND (NOT half_day OR to_date = from_date));
ALTER TABLE "leave_requests" ADD CONSTRAINT leave_req_days_chk CHECK (days > 0);
ALTER TABLE "leave_requests" ADD CONSTRAINT leave_req_status_chk CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE "leave_requests" ADD CONSTRAINT leave_req_decided_chk CHECK ((status = 'PENDING') = (decided_at IS NULL));

ALTER TABLE "staff_attendance" ADD CONSTRAINT staff_att_status_chk CHECK (status IN ('PRESENT','ABSENT','HALF_DAY','LEAVE','ON_DUTY'));
ALTER TABLE "staff_attendance" ADD CONSTRAINT staff_att_source_chk CHECK (source IN ('MANUAL','APP'));
ALTER TABLE "staff_attendance" ADD CONSTRAINT staff_att_times_chk CHECK (
  (check_in IS NULL OR check_in ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (check_out IS NULL OR check_out ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  AND (check_in IS NULL OR check_out IS NULL OR check_out > check_in));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_types','leave_requests','staff_attendance'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "leave_types", "leave_requests", "staff_attendance" FROM eduerp_app;
  END IF;
END $$;
