






-- CreateTable
CREATE TABLE "enquiries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "enquiry_no" VARCHAR(40) NOT NULL,
    "student_name" VARCHAR(150) NOT NULL,
    "dob" DATE,
    "parent_name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(150),
    "source" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "next_follow_up" DATE,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_followups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enquiry_id" UUID NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "remarks" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "next_follow_up" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "enquiry_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "enquiry_id" UUID,
    "application_no" VARCHAR(40) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80),
    "name_local" VARCHAR(150),
    "dob" DATE NOT NULL,
    "gender" VARCHAR(10) NOT NULL,
    "category" VARCHAR(10),
    "religion" VARCHAR(30),
    "mother_tongue" VARCHAR(30),
    "aadhaar_last4" CHAR(4),
    "father_name" VARCHAR(150),
    "mother_name" VARCHAR(150),
    "guardian_name" VARCHAR(150),
    "parent_phone" VARCHAR(15) NOT NULL,
    "parent_email" VARCHAR(150),
    "address" VARCHAR(500),
    "previous_institution" VARCHAR(200),
    "previous_marks_percent" DECIMAL(5,2),
    "duplicate_reason" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    "decision_remarks" VARCHAR(500),
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "student_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "admission_no" VARCHAR(40) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80),
    "name_local" VARCHAR(150),
    "dob" DATE NOT NULL,
    "gender" VARCHAR(10) NOT NULL,
    "category" VARCHAR(10),
    "religion" VARCHAR(30),
    "mother_tongue" VARCHAR(30),
    "aadhaar_last4" CHAR(4),
    "address" VARCHAR(500),
    "admission_date" DATE NOT NULL,
    "photo_file_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(15),
    "email" VARCHAR(150),
    "occupation" VARCHAR(100),
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "relation" VARCHAR(20) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "roll_no" VARCHAR(10),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "enrolled_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enquiries_tenant_id_status_next_follow_up_idx" ON "enquiries"("tenant_id", "status", "next_follow_up");

-- CreateIndex
CREATE INDEX "enquiries_tenant_id_phone_idx" ON "enquiries"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "enquiries_tenant_id_id_key" ON "enquiries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "enquiries_tenant_id_enquiry_no_key" ON "enquiries"("tenant_id", "enquiry_no");

-- CreateIndex
CREATE INDEX "enquiry_followups_enquiry_id_created_at_idx" ON "enquiry_followups"("enquiry_id", "created_at");

-- CreateIndex
CREATE INDEX "admission_applications_tenant_id_academic_year_id_status_idx" ON "admission_applications"("tenant_id", "academic_year_id", "status");

-- CreateIndex
CREATE INDEX "admission_applications_tenant_id_parent_phone_idx" ON "admission_applications"("tenant_id", "parent_phone");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_tenant_id_id_key" ON "admission_applications"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_tenant_id_application_no_key" ON "admission_applications"("tenant_id", "application_no");

-- CreateIndex
CREATE INDEX "students_tenant_id_campus_id_status_idx" ON "students"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_id_key" ON "students"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_admission_no_key" ON "students"("tenant_id", "admission_no");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_phone_idx" ON "guardians"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_tenant_id_id_key" ON "guardians"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "student_guardians_tenant_id_guardian_id_idx" ON "student_guardians"("tenant_id", "guardian_id");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_section_id_status_idx" ON "student_enrollments"("tenant_id", "section_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_tenant_id_id_key" ON "student_enrollments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_tenant_id_program_level_id_fkey" FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_followups" ADD CONSTRAINT "enquiry_followups_tenant_id_enquiry_id_fkey" FOREIGN KEY ("tenant_id", "enquiry_id") REFERENCES "enquiries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_program_level_id_fkey" FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_enquiry_id_fkey" FOREIGN KEY ("tenant_id", "enquiry_id") REFERENCES "enquiries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenant_id_guardian_id_fkey" FOREIGN KEY ("tenant_id", "guardian_id") REFERENCES "guardians"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_section_id_fkey" FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Similar-name matching for the duplicate check and student search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "enquiries" ADD CONSTRAINT enquiries_source_chk CHECK (source IN ('WALK_IN','WEBSITE','PHONE','REFERRAL','CAMPAIGN','SOCIAL'));
ALTER TABLE "enquiries" ADD CONSTRAINT enquiries_status_chk CHECK (status IN ('NEW','FOLLOW_UP','INTERESTED','CONVERTED','LOST'));
ALTER TABLE "enquiry_followups" ADD CONSTRAINT enquiry_followups_mode_chk CHECK (mode IN ('CALL','VISIT','SMS','WHATSAPP'));
ALTER TABLE "enquiry_followups" ADD CONSTRAINT enquiry_followups_status_chk CHECK (status IN ('FOLLOW_UP','INTERESTED','LOST'));

ALTER TABLE "admission_applications" ADD CONSTRAINT applications_status_chk CHECK (status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','WAITLISTED','ENROLLED','CANCELLED'));
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_gender_chk CHECK (gender IN ('MALE','FEMALE','OTHER'));
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_category_chk CHECK (category IN ('GENERAL','SC','ST','OBC','CAT_1','2A','2B','3A','3B'));
-- Aadhaar (G-16): only ever the last 4 digits.
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_aadhaar_chk CHECK (aadhaar_last4 ~ '^[0-9]{4}$');
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_marks_chk CHECK (previous_marks_percent BETWEEN 0 AND 100);
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_parent_chk CHECK (coalesce(father_name, mother_name, guardian_name) IS NOT NULL);
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_enrolled_chk CHECK ((status = 'ENROLLED') = (student_id IS NOT NULL));
ALTER TABLE "admission_applications" ADD CONSTRAINT applications_reject_reason_chk CHECK (status <> 'REJECTED' OR length(decision_remarks) >= 5);
-- One application per student.
CREATE UNIQUE INDEX applications_student_uq ON "admission_applications" (student_id) WHERE student_id IS NOT NULL;

ALTER TABLE "students" ADD CONSTRAINT students_status_chk CHECK (status IN ('ACTIVE','INACTIVE','TRANSFERRED','PASSED_OUT','DROPPED'));
ALTER TABLE "students" ADD CONSTRAINT students_gender_chk CHECK (gender IN ('MALE','FEMALE','OTHER'));
ALTER TABLE "students" ADD CONSTRAINT students_category_chk CHECK (category IN ('GENERAL','SC','ST','OBC','CAT_1','2A','2B','3A','3B'));
ALTER TABLE "students" ADD CONSTRAINT students_aadhaar_chk CHECK (aadhaar_last4 ~ '^[0-9]{4}$');
ALTER TABLE "student_guardians" ADD CONSTRAINT student_guardians_relation_chk CHECK (relation IN ('FATHER','MOTHER','GUARDIAN'));
ALTER TABLE "student_enrollments" ADD CONSTRAINT enrollments_status_chk CHECK (status IN ('ACTIVE','PROMOTED','DETAINED','TRANSFERRED','CANCELLED'));

-- One primary contact per student; one active class per student per academic year.
CREATE UNIQUE INDEX student_guardians_primary_uq ON "student_guardians" (student_id) WHERE is_primary;
CREATE UNIQUE INDEX enrollments_active_uq ON "student_enrollments" (student_id, academic_year_id) WHERE status = 'ACTIVE';

-- Name search (duplicate check, M1.3 student search).
CREATE INDEX applications_name_trgm ON "admission_applications" USING gin ((lower(first_name || ' ' || coalesce(last_name, ''))) gin_trgm_ops);
CREATE INDEX students_name_trgm ON "students" USING gin ((lower(first_name || ' ' || coalesce(last_name, ''))) gin_trgm_ops);
CREATE INDEX enquiries_name_trgm ON "enquiries" USING gin ((lower(student_name)) gin_trgm_ops);

-- A decided application keeps its details: only the decision/enrolment fields may change after review.
CREATE OR REPLACE FUNCTION applications_lock_decided() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workflow text[] := ARRAY['status','decision_remarks','decided_at','decided_by','student_id','updated_at','updated_by'];
BEGIN
  IF OLD.status NOT IN ('SUBMITTED','UNDER_REVIEW') AND (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
    RAISE EXCEPTION 'application_locked: a decided application cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('ENROLLED','REJECTED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'application_final: % is a final status', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER applications_lock_decided_trg BEFORE UPDATE ON "admission_applications" FOR EACH ROW EXECUTE FUNCTION applications_lock_decided();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['enquiries','enquiry_followups','admission_applications','students','guardians','student_guardians','student_enrollments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Admission and student history is never deleted; status changes instead.
    REVOKE DELETE, TRUNCATE ON "enquiries", "enquiry_followups", "admission_applications", "students", "student_enrollments" FROM eduerp_app;
  END IF;
END $$;
