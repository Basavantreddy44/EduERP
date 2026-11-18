-- CreateTable
CREATE TABLE "grade_scales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "preset_code" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grade_scale_id" UUID NOT NULL,
    "grade" VARCHAR(5) NOT NULL,
    "min_percent" DECIMAL(5,2) NOT NULL,
    "grade_point" DECIMAL(4,2),
    "description" VARCHAR(50),
    "is_fail" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "grade_scale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_schemes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "board_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "preset_code" VARCHAR(20),
    "result_method" VARCHAR(10) NOT NULL DEFAULT 'MARKS',
    "grade_scale_id" UUID NOT NULL,
    "co_scale_id" UUID,
    "pass_percent" DECIMAL(5,2) NOT NULL,
    "subject_pass_percent" DECIMAL(5,2) NOT NULL,
    "rounding_rule" VARCHAR(10) NOT NULL DEFAULT 'ROUND',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "assessment_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_terms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "final_weight" DECIMAL(5,2) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "scheme_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "term_code" VARCHAR(20) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "max_marks" DECIMAL(6,2) NOT NULL,
    "weightage" DECIMAL(5,2) NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "assessment_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,

    CONSTRAINT "scheme_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "co_scholastic_areas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "co_scholastic_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "co_scholastic_grades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_code" VARCHAR(20) NOT NULL,
    "grade" VARCHAR(5) NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "co_scholastic_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "exam_date" DATE NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "max_marks" DECIMAL(6,2) NOT NULL,
    "pass_marks" DECIMAL(6,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_mark_sheets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_mark_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_marks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "marks" DECIMAL(6,2),
    "attendance_code" VARCHAR(12) NOT NULL DEFAULT 'PRESENT',
    "entered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_publications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "term_code" VARCHAR(20) NOT NULL,
    "version" SMALLINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "prepared_by" UUID NOT NULL,
    "prepared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "result_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "total" DECIMAL(8,2) NOT NULL,
    "max_total" DECIMAL(8,2) NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "grade" VARCHAR(5),
    "class_rank" INTEGER,
    "attendance_percent" DECIMAL(5,2),
    "remarks" VARCHAR(500),
    "result_status" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_result_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "components" JSONB NOT NULL,
    "percent" DECIMAL(6,2) NOT NULL,
    "grade" VARCHAR(5),
    "grade_point" DECIMAL(4,2),
    "is_pass" BOOLEAN NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "exam_result_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_tenant_id_id_key" ON "grade_scales"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_tenant_id_name_key" ON "grade_scales"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scale_items_tenant_id_grade_scale_id_min_percent_key" ON "grade_scale_items"("tenant_id", "grade_scale_id", "min_percent");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_schemes_tenant_id_id_key" ON "assessment_schemes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_schemes_tenant_id_name_key" ON "assessment_schemes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_terms_tenant_id_scheme_id_code_key" ON "scheme_terms"("tenant_id", "scheme_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_components_tenant_id_id_key" ON "assessment_components"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_components_tenant_id_scheme_id_code_key" ON "assessment_components"("tenant_id", "scheme_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_levels_tenant_id_program_level_id_key" ON "scheme_levels"("tenant_id", "program_level_id");

-- CreateIndex
CREATE UNIQUE INDEX "co_scholastic_areas_tenant_id_id_key" ON "co_scholastic_areas"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "co_scholastic_grades_tenant_id_area_id_student_id_academic__key" ON "co_scholastic_grades"("tenant_id", "area_id", "student_id", "academic_year_id", "term_code");

-- CreateIndex
CREATE UNIQUE INDEX "exams_tenant_id_id_key" ON "exams"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exams_tenant_id_campus_id_academic_year_id_component_id_key" ON "exams"("tenant_id", "campus_id", "academic_year_id", "component_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_tenant_id_id_key" ON "exam_subjects"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_tenant_id_exam_id_program_level_id_subject_id_key" ON "exam_subjects"("tenant_id", "exam_id", "program_level_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_mark_sheets_tenant_id_id_key" ON "exam_mark_sheets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_mark_sheets_tenant_id_exam_subject_id_section_id_key" ON "exam_mark_sheets"("tenant_id", "exam_subject_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_marks_tenant_id_sheet_id_student_id_key" ON "exam_marks"("tenant_id", "sheet_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_publications_tenant_id_id_key" ON "result_publications"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "result_publications_tenant_id_section_id_academic_year_id_t_key" ON "result_publications"("tenant_id", "section_id", "academic_year_id", "term_code", "version");

-- CreateIndex
CREATE INDEX "exam_results_tenant_id_student_id_idx" ON "exam_results"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_results_tenant_id_id_key" ON "exam_results"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_results_tenant_id_publication_id_student_id_key" ON "exam_results"("tenant_id", "publication_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_result_subjects_tenant_id_result_id_subject_id_key" ON "exam_result_subjects"("tenant_id", "result_id", "subject_id");

-- AddForeignKey
ALTER TABLE "grade_scale_items" ADD CONSTRAINT "grade_scale_items_tenant_id_grade_scale_id_fkey" FOREIGN KEY ("tenant_id", "grade_scale_id") REFERENCES "grade_scales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_terms" ADD CONSTRAINT "scheme_terms_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "assessment_schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "assessment_schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_levels" ADD CONSTRAINT "scheme_levels_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "assessment_schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_scholastic_areas" ADD CONSTRAINT "co_scholastic_areas_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "assessment_schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT "co_scholastic_grades_tenant_id_area_id_fkey" FOREIGN KEY ("tenant_id", "area_id") REFERENCES "co_scholastic_areas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "assessment_schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_id_component_id_fkey" FOREIGN KEY ("tenant_id", "component_id") REFERENCES "assessment_components"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_tenant_id_exam_id_fkey" FOREIGN KEY ("tenant_id", "exam_id") REFERENCES "exams"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT "exam_mark_sheets_tenant_id_exam_subject_id_fkey" FOREIGN KEY ("tenant_id", "exam_subject_id") REFERENCES "exam_subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_tenant_id_sheet_id_fkey" FOREIGN KEY ("tenant_id", "sheet_id") REFERENCES "exam_mark_sheets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_tenant_id_publication_id_fkey" FOREIGN KEY ("tenant_id", "publication_id") REFERENCES "result_publications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_result_subjects" ADD CONSTRAINT "exam_result_subjects_tenant_id_result_id_fkey" FOREIGN KEY ("tenant_id", "result_id") REFERENCES "exam_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Tenant-scoped links to existing tables (kept out of schema.prisma).
ALTER TABLE "assessment_schemes" ADD CONSTRAINT schemes_board_fkey FOREIGN KEY ("tenant_id", "board_id") REFERENCES "education_boards"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "assessment_schemes" ADD CONSTRAINT schemes_scale_fkey FOREIGN KEY ("tenant_id", "grade_scale_id") REFERENCES "grade_scales"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "assessment_schemes" ADD CONSTRAINT schemes_co_scale_fkey FOREIGN KEY ("tenant_id", "co_scale_id") REFERENCES "grade_scales"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "scheme_levels" ADD CONSTRAINT scheme_levels_level_fkey FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT co_grades_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT co_grades_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exams" ADD CONSTRAINT exams_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exams" ADD CONSTRAINT exams_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exam_subjects" ADD CONSTRAINT exam_subjects_level_fkey FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exam_subjects" ADD CONSTRAINT exam_subjects_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT mark_sheets_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exam_marks" ADD CONSTRAINT exam_marks_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "result_publications" ADD CONSTRAINT publications_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "result_publications" ADD CONSTRAINT publications_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "result_publications" ADD CONSTRAINT publications_scheme_fkey FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "assessment_schemes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exam_results" ADD CONSTRAINT exam_results_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exam_result_subjects" ADD CONSTRAINT result_subjects_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "grade_scales" ADD CONSTRAINT grade_scales_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "grade_scale_items" ADD CONSTRAINT scale_items_pct_chk CHECK (min_percent >= 0 AND min_percent <= 100);
ALTER TABLE "assessment_schemes" ADD CONSTRAINT schemes_method_chk CHECK (result_method IN ('MARKS','GRADES'));
ALTER TABLE "assessment_schemes" ADD CONSTRAINT schemes_rounding_chk CHECK (rounding_rule IN ('NONE','ROUND','CEIL'));
ALTER TABLE "assessment_schemes" ADD CONSTRAINT schemes_pct_chk CHECK (pass_percent BETWEEN 0 AND 100 AND subject_pass_percent BETWEEN 0 AND 100);
ALTER TABLE "assessment_components" ADD CONSTRAINT components_marks_chk CHECK (max_marks > 0 AND weightage BETWEEN 0 AND 100);
ALTER TABLE "assessment_components" ADD CONSTRAINT components_status_chk CHECK (status IN ('ACTIVE','REPLACED'));
ALTER TABLE "co_scholastic_areas" ADD CONSTRAINT co_areas_status_chk CHECK (status IN ('ACTIVE','REPLACED'));
ALTER TABLE "exams" ADD CONSTRAINT exams_dates_chk CHECK (end_date >= start_date);
ALTER TABLE "exams" ADD CONSTRAINT exams_status_chk CHECK (status IN ('SCHEDULED','CLOSED'));
ALTER TABLE "exam_subjects" ADD CONSTRAINT exam_subjects_marks_chk CHECK (max_marks > 0 AND (pass_marks IS NULL OR pass_marks <= max_marks));
ALTER TABLE "exam_subjects" ADD CONSTRAINT exam_subjects_status_chk CHECK (status IN ('ACTIVE','REMOVED'));
ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT mark_sheets_status_chk CHECK (status IN ('PENDING','SUBMITTED','VERIFIED'));
ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT mark_sheets_verifier_chk CHECK (status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_by IS DISTINCT FROM submitted_by));
ALTER TABLE "exam_marks" ADD CONSTRAINT exam_marks_code_chk CHECK (attendance_code IN ('PRESENT','ABSENT','MALPRACTICE','EXEMPT'));
ALTER TABLE "exam_marks" ADD CONSTRAINT exam_marks_value_chk CHECK ((attendance_code = 'PRESENT' AND marks IS NOT NULL AND marks >= 0) OR (attendance_code <> 'PRESENT' AND marks IS NULL));
ALTER TABLE "result_publications" ADD CONSTRAINT publications_status_chk CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED'));
ALTER TABLE "result_publications" ADD CONSTRAINT publications_published_chk CHECK (status = 'DRAFT' OR published_by IS NOT NULL);
ALTER TABLE "exam_results" ADD CONSTRAINT exam_results_status_chk CHECK (result_status IN ('PASS','FAIL'));

-- One draft and one published version per section and term.
CREATE UNIQUE INDEX publications_draft_uq ON "result_publications" ("tenant_id", "section_id", "academic_year_id", "term_code") WHERE status = 'DRAFT';
CREATE UNIQUE INDEX publications_published_uq ON "result_publications" ("tenant_id", "section_id", "academic_year_id", "term_code") WHERE status = 'PUBLISHED';

-- A mark above the paper's maximum is refused by the database too.
CREATE OR REPLACE FUNCTION exam_marks_max_chk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mx numeric;
BEGIN
  SELECT es.max_marks INTO mx FROM exam_mark_sheets sh JOIN exam_subjects es ON es.id = sh.exam_subject_id WHERE sh.id = NEW.sheet_id;
  IF NEW.marks IS NOT NULL AND NEW.marks > mx THEN
    RAISE EXCEPTION 'Marks above the maximum (%)', mx USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exam_marks_max_chk BEFORE INSERT OR UPDATE ON "exam_marks" FOR EACH ROW EXECUTE FUNCTION exam_marks_max_chk();

-- Results can be replaced only while their version is a draft; a published version is kept as it is.
CREATE OR REPLACE FUNCTION exam_results_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_TABLE_NAME = 'exam_results' THEN
    SELECT status INTO st FROM result_publications WHERE id = OLD.publication_id;
  ELSE
    SELECT p.status INTO st FROM exam_results r JOIN result_publications p ON p.id = r.publication_id WHERE r.id = OLD.result_id;
  END IF;
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Published results cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER exam_results_draft_only BEFORE UPDATE OR DELETE ON "exam_results" FOR EACH ROW EXECUTE FUNCTION exam_results_draft_only();
CREATE TRIGGER exam_result_subjects_draft_only BEFORE UPDATE OR DELETE ON "exam_result_subjects" FOR EACH ROW EXECUTE FUNCTION exam_results_draft_only();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['grade_scales','grade_scale_items','assessment_schemes','scheme_terms','assessment_components','scheme_levels','co_scholastic_areas','co_scholastic_grades','exams','exam_subjects','exam_mark_sheets','exam_marks','result_publications','exam_results','exam_result_subjects'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted, except: a scheme's terms and class links (replaced while no exam uses
-- the scheme) and draft results (recalculated; the trigger above protects published ones).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "grade_scales", "grade_scale_items", "assessment_schemes", "assessment_components", "co_scholastic_areas", "co_scholastic_grades", "exams", "exam_subjects", "exam_mark_sheets", "exam_marks", "result_publications" FROM eduerp_app;
    REVOKE TRUNCATE ON "scheme_terms", "scheme_levels", "exam_results", "exam_result_subjects" FROM eduerp_app;
  END IF;
END $$;
