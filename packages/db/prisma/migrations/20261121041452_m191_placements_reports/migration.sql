-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "industry" VARCHAR(100),
    "website" VARCHAR(200),
    "hr_name" VARCHAR(100),
    "hr_email" VARCHAR(150),
    "hr_phone" VARCHAR(15),
    "address" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "blacklist_reason" VARCHAR(300),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_placement_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "resume_file_id" UUID,
    "skills" VARCHAR(500),
    "preferred_locations" VARCHAR(200),
    "is_opted_in" BOOLEAN NOT NULL DEFAULT true,
    "is_placed" BOOLEAN NOT NULL DEFAULT false,
    "passing_year" SMALLINT,
    "score_type" VARCHAR(10),
    "score" DECIMAL(5,2),
    "backlogs" SMALLINT,
    "score_verified_by" UUID,
    "score_verified_at" TIMESTAMPTZ(6),
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_placement_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_drives" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "job_type" VARCHAR(20) NOT NULL DEFAULT 'FULL_TIME',
    "ctc_min" DECIMAL(14,2),
    "ctc_max" DECIMAL(14,2),
    "eligible_program_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "passing_year" SMALLINT NOT NULL,
    "score_type" VARCHAR(10) NOT NULL DEFAULT 'CGPA',
    "min_score" DECIMAL(5,2),
    "max_backlogs" SMALLINT,
    "allow_placed" BOOLEAN NOT NULL DEFAULT false,
    "last_date_to_apply" DATE NOT NULL,
    "drive_date" DATE,
    "rounds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" VARCHAR(2000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "opened_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "placement_drives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by" UUID NOT NULL,
    "eligibility_snapshot" JSONB NOT NULL,
    "current_round" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
    "remarks" VARCHAR(300),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "placement_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_offers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "ctc" DECIMAL(14,2) NOT NULL,
    "offer_date" DATE NOT NULL,
    "joining_date" DATE,
    "offer_letter_file_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OFFERED',
    "decided_at" TIMESTAMPTZ(6),
    "remarks" VARCHAR(300),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "placement_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "report_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "schedule" VARCHAR(10) NOT NULL DEFAULT 'NONE',
    "schedule_format" VARCHAR(10) NOT NULL DEFAULT 'XLSX',
    "last_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "saved_report_id" UUID,
    "report_code" VARCHAR(50) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "format" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "row_count" INTEGER,
    "storage_key" VARCHAR(500),
    "file_name" VARCHAR(200),
    "size_bytes" INTEGER,
    "error" VARCHAR(500),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_name_key" ON "companies"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "student_placement_profiles_tenant_id_id_key" ON "student_placement_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "student_placement_profiles_tenant_id_student_id_key" ON "student_placement_profiles"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "placement_drives_tenant_id_campus_id_status_idx" ON "placement_drives"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "placement_drives_tenant_id_id_key" ON "placement_drives"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "placement_applications_tenant_id_student_id_idx" ON "placement_applications"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_applications_tenant_id_id_key" ON "placement_applications"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_applications_tenant_id_drive_id_student_id_key" ON "placement_applications"("tenant_id", "drive_id", "student_id");

-- CreateIndex
CREATE INDEX "placement_offers_tenant_id_student_id_idx" ON "placement_offers"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_offers_tenant_id_id_key" ON "placement_offers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_offers_tenant_id_application_id_key" ON "placement_offers"("tenant_id", "application_id");

-- CreateIndex
CREATE INDEX "saved_reports_tenant_id_user_id_idx" ON "saved_reports"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_reports_tenant_id_id_key" ON "saved_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_storage_key_key" ON "export_jobs"("storage_key");

-- CreateIndex
CREATE INDEX "export_jobs_tenant_id_user_id_created_at_idx" ON "export_jobs"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_tenant_id_id_key" ON "export_jobs"("tenant_id", "id");

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links.
ALTER TABLE "student_placement_profiles" ADD CONSTRAINT spp_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_placement_profiles" ADD CONSTRAINT spp_resume_fkey FOREIGN KEY ("tenant_id", "resume_file_id") REFERENCES "files"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_drives" ADD CONSTRAINT drives_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_drives" ADD CONSTRAINT drives_company_fkey FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_applications" ADD CONSTRAINT apps_drive_fkey FOREIGN KEY ("tenant_id", "drive_id") REFERENCES "placement_drives"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_applications" ADD CONSTRAINT apps_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_offers" ADD CONSTRAINT offers_application_fkey FOREIGN KEY ("tenant_id", "application_id") REFERENCES "placement_applications"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_offers" ADD CONSTRAINT offers_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "placement_offers" ADD CONSTRAINT offers_letter_fkey FOREIGN KEY ("tenant_id", "offer_letter_file_id") REFERENCES "files"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "export_jobs" ADD CONSTRAINT exports_saved_fkey FOREIGN KEY ("tenant_id", "saved_report_id") REFERENCES "saved_reports"("tenant_id", "id") ON DELETE SET NULL ("saved_report_id");

-- Allowed values and shapes.
ALTER TABLE "companies" ADD CONSTRAINT companies_chk CHECK (status IN ('ACTIVE','BLACKLISTED') AND (status <> 'BLACKLISTED' OR blacklist_reason IS NOT NULL));
-- A score has its type; CGPA 0–10, percentage 0–100; a verified score has who and when.
ALTER TABLE "student_placement_profiles" ADD CONSTRAINT spp_chk CHECK (
  (score IS NULL OR (score_type = 'CGPA' AND score BETWEEN 0 AND 10) OR (score_type = 'PERCENT' AND score BETWEEN 0 AND 100))
  AND (score_type IS NULL OR score_type IN ('CGPA','PERCENT'))
  AND (backlogs IS NULL OR backlogs >= 0)
  AND (score IS NULL OR (score_verified_by IS NOT NULL AND score_verified_at IS NOT NULL)));
ALTER TABLE "placement_drives" ADD CONSTRAINT drives_chk CHECK (
  job_type IN ('FULL_TIME','INTERNSHIP') AND status IN ('DRAFT','OPEN','CLOSED','COMPLETED','CANCELLED') AND score_type IN ('CGPA','PERCENT')
  AND (min_score IS NULL OR (score_type = 'CGPA' AND min_score BETWEEN 0 AND 10) OR (score_type = 'PERCENT' AND min_score BETWEEN 0 AND 100))
  AND (max_backlogs IS NULL OR max_backlogs >= 0)
  AND (ctc_min IS NULL OR ctc_min >= 0) AND (ctc_max IS NULL OR ctc_min IS NULL OR ctc_max >= ctc_min)
  AND (drive_date IS NULL OR drive_date >= last_date_to_apply)
  AND (status = 'DRAFT' OR status = 'CANCELLED' OR opened_at IS NOT NULL));
ALTER TABLE "placement_applications" ADD CONSTRAINT apps_chk CHECK (status IN ('APPLIED','SHORTLISTED','IN_PROCESS','SELECTED','REJECTED','WITHDRAWN'));
ALTER TABLE "placement_offers" ADD CONSTRAINT offers_chk CHECK (
  ctc > 0 AND status IN ('OFFERED','ACCEPTED','DECLINED','REVOKED') AND (joining_date IS NULL OR joining_date >= offer_date)
  AND (status = 'OFFERED' OR decided_at IS NOT NULL));
ALTER TABLE "saved_reports" ADD CONSTRAINT saved_reports_chk CHECK (schedule IN ('NONE','WEEKLY','MONTHLY') AND schedule_format IN ('XLSX','CSV'));
-- A finished export has its file, row count and expiry.
ALTER TABLE "export_jobs" ADD CONSTRAINT exports_chk CHECK (
  format IN ('XLSX','CSV') AND status IN ('QUEUED','RUNNING','DONE','FAILED')
  AND (status <> 'DONE' OR (storage_key IS NOT NULL AND row_count IS NOT NULL AND expires_at IS NOT NULL)));

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','student_placement_profiles','placement_drives','placement_applications','placement_offers','saved_reports','export_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Placement records are never deleted (drives are cancelled, applications withdrawn, offers revoked).
-- Saved reports may be deleted by their owner; export jobs stay as the export log (their files expire).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "companies", "student_placement_profiles", "placement_drives", "placement_applications", "placement_offers", "export_jobs" FROM eduerp_app;
  END IF;
END $$;
