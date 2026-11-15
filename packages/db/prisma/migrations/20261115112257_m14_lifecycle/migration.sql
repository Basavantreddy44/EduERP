







-- CreateTable
CREATE TABLE "promotion_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_year_id" UUID NOT NULL,
    "to_year_id" UUID NOT NULL,
    "promoted" INTEGER NOT NULL DEFAULT 0,
    "detained" INTEGER NOT NULL DEFAULT 0,
    "passed_out" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "level_ids" UUID[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "promotion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "tc_no" VARCHAR(40) NOT NULL,
    "issue_date" DATE NOT NULL,
    "leaving_date" DATE NOT NULL,
    "last_class" VARCHAR(120),
    "last_year" VARCHAR(20),
    "reason" VARCHAR(200) NOT NULL,
    "conduct" VARCHAR(30) NOT NULL,
    "remarks" VARCHAR(300),
    "dues_cleared" BOOLEAN NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "transfer_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotion_runs_tenant_id_created_at_idx" ON "promotion_runs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_runs_tenant_id_id_key" ON "promotion_runs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_certificates_tenant_id_id_key" ON "transfer_certificates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_certificates_tenant_id_tc_no_key" ON "transfer_certificates"("tenant_id", "tc_no");

-- AddForeignKey
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- A final-year class place ends as COMPLETED (the student passed out).
ALTER TABLE "student_enrollments" DROP CONSTRAINT enrollments_status_chk;
ALTER TABLE "student_enrollments" ADD CONSTRAINT enrollments_status_chk CHECK (status IN ('ACTIVE','PROMOTED','DETAINED','TRANSFERRED','CANCELLED','MOVED','LEFT','COMPLETED'));

ALTER TABLE "transfer_certificates" ADD CONSTRAINT tc_status_chk CHECK (status IN ('ISSUED','CANCELLED'));
ALTER TABLE "transfer_certificates" ADD CONSTRAINT tc_conduct_chk CHECK (conduct IN ('GOOD','SATISFACTORY','NEEDS_IMPROVEMENT'));
ALTER TABLE "transfer_certificates" ADD CONSTRAINT tc_dates_chk CHECK (issue_date >= leaving_date);
-- One issued TC per student.
CREATE UNIQUE INDEX tc_one_issued_uq ON "transfer_certificates" (student_id) WHERE status = 'ISSUED';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['promotion_runs','transfer_certificates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "promotion_runs" FROM eduerp_app;
    REVOKE DELETE, TRUNCATE ON "transfer_certificates" FROM eduerp_app;
  END IF;
END $$;
