-- CreateTable
CREATE TABLE "syllabus_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "planned_hours" DECIMAL(5,1),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "syllabus_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_topics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "employee_id" UUID,
    "planned_date" DATE NOT NULL,
    "objectives" VARCHAR(2000),
    "teaching_method" VARCHAR(100),
    "resources" VARCHAR(1000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "completed_on" DATE,
    "notes" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_progress" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "completed_date" DATE NOT NULL,
    "employee_id" UUID,
    "lesson_plan_id" UUID,
    "remarks" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_materials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "section_id" UUID,
    "subject_id" UUID NOT NULL,
    "topic_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "material_type" VARCHAR(10) NOT NULL,
    "url" VARCHAR(500),
    "body" TEXT,
    "file_id" UUID,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "study_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_views" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "first_viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "view_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "material_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "certificate_type" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "certificate_type" VARCHAR(20) NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "purpose" VARCHAR(200) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(8000),
    "certificate_no" VARCHAR(40),
    "issue_date" DATE,
    "verification_code" VARCHAR(14),
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "issued_by" UUID,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_verifications" (
    "code" VARCHAR(14) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_verifications_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "syllabus_units_tenant_id_academic_year_id_program_level_id__idx" ON "syllabus_units"("tenant_id", "academic_year_id", "program_level_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_units_tenant_id_id_key" ON "syllabus_units"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_topics_tenant_id_id_key" ON "syllabus_topics"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "lesson_plans_tenant_id_section_id_subject_id_planned_date_idx" ON "lesson_plans"("tenant_id", "section_id", "subject_id", "planned_date");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_plans_tenant_id_id_key" ON "lesson_plans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_progress_tenant_id_section_id_topic_id_key" ON "syllabus_progress"("tenant_id", "section_id", "topic_id");

-- CreateIndex
CREATE INDEX "study_materials_tenant_id_program_level_id_subject_id_idx" ON "study_materials"("tenant_id", "program_level_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_materials_tenant_id_id_key" ON "study_materials"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "material_views_tenant_id_material_id_student_id_key" ON "material_views"("tenant_id", "material_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_templates_tenant_id_id_key" ON "certificate_templates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_templates_tenant_id_name_key" ON "certificate_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_student_id_idx" ON "certificates"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_tenant_id_id_key" ON "certificates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_tenant_id_certificate_no_key" ON "certificates"("tenant_id", "certificate_no");

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "syllabus_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_views" ADD CONSTRAINT "material_views_tenant_id_material_id_fkey" FOREIGN KEY ("tenant_id", "material_id") REFERENCES "study_materials"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "certificate_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Tenant-scoped links to existing tables (kept out of schema.prisma).
ALTER TABLE "syllabus_units" ADD CONSTRAINT syl_units_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "syllabus_units" ADD CONSTRAINT syl_units_level_fkey FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "syllabus_units" ADD CONSTRAINT syl_units_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lesson_plans" ADD CONSTRAINT lesson_plans_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lesson_plans" ADD CONSTRAINT lesson_plans_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lesson_plans" ADD CONSTRAINT lesson_plans_topic_fkey FOREIGN KEY ("tenant_id", "topic_id") REFERENCES "syllabus_topics"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lesson_plans" ADD CONSTRAINT lesson_plans_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "syllabus_progress" ADD CONSTRAINT syl_progress_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "syllabus_progress" ADD CONSTRAINT syl_progress_topic_fkey FOREIGN KEY ("tenant_id", "topic_id") REFERENCES "syllabus_topics"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "syllabus_progress" ADD CONSTRAINT syl_progress_plan_fkey FOREIGN KEY ("tenant_id", "lesson_plan_id") REFERENCES "lesson_plans"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "study_materials" ADD CONSTRAINT materials_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "study_materials" ADD CONSTRAINT materials_level_fkey FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "study_materials" ADD CONSTRAINT materials_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "study_materials" ADD CONSTRAINT materials_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "study_materials" ADD CONSTRAINT materials_topic_fkey FOREIGN KEY ("tenant_id", "topic_id") REFERENCES "syllabus_topics"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "study_materials" ADD CONSTRAINT materials_file_fkey FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT;
ALTER TABLE "material_views" ADD CONSTRAINT material_views_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "certificates" ADD CONSTRAINT certificates_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "certificates" ADD CONSTRAINT certificates_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "certificate_verifications" ADD CONSTRAINT cert_verify_cert_fkey FOREIGN KEY ("tenant_id", "certificate_id") REFERENCES "certificates"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "syllabus_units" ADD CONSTRAINT syl_units_status_chk CHECK (status IN ('ACTIVE','REMOVED'));
ALTER TABLE "syllabus_topics" ADD CONSTRAINT syl_topics_status_chk CHECK (status IN ('ACTIVE','REMOVED'));
ALTER TABLE "lesson_plans" ADD CONSTRAINT lesson_plans_status_chk CHECK (status IN ('PLANNED','COMPLETED','POSTPONED'));
ALTER TABLE "lesson_plans" ADD CONSTRAINT lesson_plans_done_chk CHECK ((status = 'COMPLETED') = (completed_on IS NOT NULL));
ALTER TABLE "study_materials" ADD CONSTRAINT materials_type_chk CHECK (material_type IN ('NOTE','LINK','VIDEO','FILE'));
ALTER TABLE "study_materials" ADD CONSTRAINT materials_content_chk CHECK (
  (material_type = 'NOTE' AND body IS NOT NULL) OR (material_type IN ('LINK','VIDEO') AND url LIKE 'https://%') OR (material_type = 'FILE' AND file_id IS NOT NULL));
ALTER TABLE "study_materials" ADD CONSTRAINT materials_status_chk CHECK (status IN ('ACTIVE','ARCHIVED'));
ALTER TABLE "certificate_templates" ADD CONSTRAINT cert_templates_type_chk CHECK (certificate_type IN ('BONAFIDE','STUDY','CHARACTER','CONDUCT'));
ALTER TABLE "certificate_templates" ADD CONSTRAINT cert_templates_lang_chk CHECK (language IN ('en','kn'));
ALTER TABLE "certificate_templates" ADD CONSTRAINT cert_templates_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "certificates" ADD CONSTRAINT certificates_status_chk CHECK (status IN ('REQUESTED','ISSUED','REJECTED','CANCELLED'));
-- An issued (or cancelled) certificate always has its number, date, text and code.
ALTER TABLE "certificates" ADD CONSTRAINT certificates_issued_chk CHECK (status IN ('REQUESTED','REJECTED') OR (certificate_no IS NOT NULL AND issue_date IS NOT NULL AND body IS NOT NULL AND verification_code IS NOT NULL));
ALTER TABLE "certificates" ADD CONSTRAINT certificates_cancel_chk CHECK (status <> 'CANCELLED' OR (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL));
CREATE UNIQUE INDEX certificates_code_uq ON "certificates" ("verification_code") WHERE verification_code IS NOT NULL;

-- An issued certificate's text, number and code never change (only cancellation is allowed).
CREATE OR REPLACE FUNCTION certificates_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('ISSUED','CANCELLED') AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.certificate_no IS DISTINCT FROM OLD.certificate_no OR NEW.verification_code IS DISTINCT FROM OLD.verification_code OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.student_id IS DISTINCT FROM OLD.student_id OR (OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED')) THEN
    RAISE EXCEPTION 'An issued certificate cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER certificates_frozen BEFORE UPDATE ON "certificates" FOR EACH ROW EXECUTE FUNCTION certificates_frozen();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['syllabus_units','syllabus_topics','lesson_plans','syllabus_progress','study_materials','material_views','certificate_templates','certificates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;
-- certificate_verifications holds only code → institution for the public check page (no personal data):
-- it has no row-level security on purpose; the app may read it and add rows, never change or remove them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "syllabus_units", "syllabus_topics", "lesson_plans", "syllabus_progress", "study_materials", "material_views", "certificate_templates", "certificates" FROM eduerp_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "certificate_verifications" FROM eduerp_app;
  END IF;
END $$;
