








-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "class_teacher_id" UUID;

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_local" VARCHAR(100),
    "subject_type" VARCHAR(20) NOT NULL,
    "credits" DECIMAL(4,1),
    "is_language" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "subject_group" VARCHAR(20) NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "level_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_subject_teachers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "section_subject_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "student_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "room_type" VARCHAR(20) NOT NULL,
    "capacity" INTEGER,
    "building" VARCHAR(30),
    "floor" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "version" SMALLINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "timetables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timetable_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "period_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "room_id" UUID,
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitutions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timetable_entry_id" UUID NOT NULL,
    "substitution_date" DATE NOT NULL,
    "absent_employee_id" UUID NOT NULL,
    "substitute_employee_id" UUID NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(3000),
    "due_date" DATE NOT NULL,
    "file_ids" UUID[],
    "allow_submission" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_submissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "homework_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "text" VARCHAR(5000),
    "file_id" UUID,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grade" VARCHAR(10),
    "feedback" VARCHAR(1000),
    "marked_by" UUID,
    "marked_at" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',

    CONSTRAINT "homework_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diary_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "student_id" UUID,
    "note_date" DATE NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "needs_ack" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "diary_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diary_acks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "diary_note_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "ack_by" UUID NOT NULL,
    "ack_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diary_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenant_id_id_key" ON "subjects"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenant_id_code_key" ON "subjects"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "level_subjects_tenant_id_id_key" ON "level_subjects"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "level_subjects_tenant_id_program_level_id_subject_id_key" ON "level_subjects"("tenant_id", "program_level_id", "subject_id");

-- CreateIndex
CREATE INDEX "section_subject_teachers_tenant_id_employee_id_idx" ON "section_subject_teachers"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_subject_teachers_tenant_id_id_key" ON "section_subject_teachers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "section_subject_teachers_tenant_id_section_id_subject_id_em_key" ON "section_subject_teachers"("tenant_id", "section_id", "subject_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_subjects_tenant_id_enrollment_id_subject_id_key" ON "student_subjects"("tenant_id", "enrollment_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_rooms_tenant_id_id_key" ON "class_rooms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "class_rooms_tenant_id_campus_id_name_key" ON "class_rooms"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "timetables_tenant_id_id_key" ON "timetables"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "timetables_tenant_id_section_id_version_key" ON "timetables"("tenant_id", "section_id", "version");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_employee_id_idx" ON "timetable_entries"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_tenant_id_id_key" ON "timetable_entries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_tenant_id_timetable_id_day_of_week_period_key" ON "timetable_entries"("tenant_id", "timetable_id", "day_of_week", "period_id");

-- CreateIndex
CREATE INDEX "substitutions_tenant_id_substitute_employee_id_substitution_idx" ON "substitutions"("tenant_id", "substitute_employee_id", "substitution_date");

-- CreateIndex
CREATE UNIQUE INDEX "substitutions_tenant_id_id_key" ON "substitutions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "homework_tenant_id_section_id_due_date_idx" ON "homework"("tenant_id", "section_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "homework_tenant_id_id_key" ON "homework"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "homework_submissions_tenant_id_id_key" ON "homework_submissions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "homework_submissions_tenant_id_homework_id_student_id_key" ON "homework_submissions"("tenant_id", "homework_id", "student_id");

-- CreateIndex
CREATE INDEX "diary_notes_tenant_id_section_id_note_date_idx" ON "diary_notes"("tenant_id", "section_id", "note_date");

-- CreateIndex
CREATE UNIQUE INDEX "diary_notes_tenant_id_id_key" ON "diary_notes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "diary_acks_tenant_id_diary_note_id_student_id_key" ON "diary_acks"("tenant_id", "diary_note_id", "student_id");

-- AddForeignKey
ALTER TABLE "level_subjects" ADD CONSTRAINT "level_subjects_tenant_id_subject_id_fkey" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subject_teachers" ADD CONSTRAINT "section_subject_teachers_tenant_id_subject_id_fkey" FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_tenant_id_timetable_id_fkey" FOREIGN KEY ("tenant_id", "timetable_id") REFERENCES "timetables"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_tenant_id_timetable_entry_id_fkey" FOREIGN KEY ("tenant_id", "timetable_entry_id") REFERENCES "timetable_entries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_tenant_id_homework_id_fkey" FOREIGN KEY ("tenant_id", "homework_id") REFERENCES "homework"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diary_acks" ADD CONSTRAINT "diary_acks_tenant_id_diary_note_id_fkey" FOREIGN KEY ("tenant_id", "diary_note_id") REFERENCES "diary_notes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Tenant-scoped links to existing tables (kept out of schema.prisma).
ALTER TABLE "sections" ADD CONSTRAINT sections_class_teacher_fkey FOREIGN KEY ("tenant_id", "class_teacher_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "level_subjects" ADD CONSTRAINT level_subjects_level_fkey FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "section_subject_teachers" ADD CONSTRAINT sst_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "section_subject_teachers" ADD CONSTRAINT sst_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_subjects" ADD CONSTRAINT student_subjects_enrol_fkey FOREIGN KEY ("tenant_id", "enrollment_id") REFERENCES "student_enrollments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_subjects" ADD CONSTRAINT student_subjects_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "class_rooms" ADD CONSTRAINT class_rooms_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "timetables" ADD CONSTRAINT timetables_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "timetables" ADD CONSTRAINT timetables_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "timetable_entries" ADD CONSTRAINT tt_entries_period_fkey FOREIGN KEY ("tenant_id", "period_id") REFERENCES "periods"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "timetable_entries" ADD CONSTRAINT tt_entries_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "timetable_entries" ADD CONSTRAINT tt_entries_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "timetable_entries" ADD CONSTRAINT tt_entries_room_fkey FOREIGN KEY ("tenant_id", "room_id") REFERENCES "class_rooms"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "substitutions" ADD CONSTRAINT subs_absent_fkey FOREIGN KEY ("tenant_id", "absent_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "substitutions" ADD CONSTRAINT subs_sub_fkey FOREIGN KEY ("tenant_id", "substitute_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "homework" ADD CONSTRAINT homework_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "homework" ADD CONSTRAINT homework_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "homework_submissions" ADD CONSTRAINT hw_sub_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "homework_submissions" ADD CONSTRAINT hw_sub_file_fkey FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT;
ALTER TABLE "diary_notes" ADD CONSTRAINT diary_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "diary_notes" ADD CONSTRAINT diary_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "diary_acks" ADD CONSTRAINT diary_ack_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "subjects" ADD CONSTRAINT subjects_type_chk CHECK (subject_type IN ('THEORY','PRACTICAL','THEORY_PRACTICAL','ACTIVITY'));
ALTER TABLE "subjects" ADD CONSTRAINT subjects_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "level_subjects" ADD CONSTRAINT level_subjects_group_chk CHECK (subject_group IN ('CORE','ELECTIVE','LANGUAGE_1','LANGUAGE_2','LANGUAGE_3','OPEN_ELECTIVE'));
ALTER TABLE "class_rooms" ADD CONSTRAINT class_rooms_type_chk CHECK (room_type IN ('CLASSROOM','LAB','HALL','LIBRARY','STAFF_ROOM'));
ALTER TABLE "timetables" ADD CONSTRAINT timetables_status_chk CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED'));
ALTER TABLE "timetable_entries" ADD CONSTRAINT tt_entries_day_chk CHECK (day_of_week BETWEEN 1 AND 7);
ALTER TABLE "substitutions" ADD CONSTRAINT subs_status_chk CHECK (status IN ('ASSIGNED','CANCELLED'));
ALTER TABLE "substitutions" ADD CONSTRAINT subs_people_chk CHECK (absent_employee_id <> substitute_employee_id);
ALTER TABLE "homework_submissions" ADD CONSTRAINT hw_sub_status_chk CHECK (status IN ('SUBMITTED','MARKED'));
ALTER TABLE "homework_submissions" ADD CONSTRAINT hw_sub_content_chk CHECK (text IS NOT NULL OR file_id IS NOT NULL);

-- One published and one draft timetable per section at a time.
CREATE UNIQUE INDEX timetables_published_uq ON "timetables" ("tenant_id", "section_id") WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX timetables_draft_uq ON "timetables" ("tenant_id", "section_id") WHERE status = 'DRAFT';
-- No clash in live timetables: a teacher or a room is in one place per period.
CREATE UNIQUE INDEX tt_live_teacher_uq ON "timetable_entries" ("tenant_id", "employee_id", "day_of_week", "period_id") WHERE is_live;
CREATE UNIQUE INDEX tt_live_room_uq ON "timetable_entries" ("tenant_id", "room_id", "day_of_week", "period_id") WHERE is_live AND room_id IS NOT NULL;
-- One substitute per lesson per day.
CREATE UNIQUE INDEX subs_one_uq ON "substitutions" ("tenant_id", "timetable_entry_id", "substitution_date") WHERE status = 'ASSIGNED';

-- Draft lessons are replaced on each save (deleted); live lessons can never be deleted.
CREATE OR REPLACE FUNCTION tt_entries_keep_live() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_live THEN
    RAISE EXCEPTION 'A published lesson cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER tt_entries_keep_live BEFORE DELETE ON "timetable_entries" FOR EACH ROW EXECUTE FUNCTION tt_entries_keep_live();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects','level_subjects','section_subject_teachers','student_subjects','class_rooms','timetables','timetable_entries','substitutions','homework','homework_submissions','diary_notes','diary_acks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted; the three assignment lists (syllabus, subject teachers, electives) and
-- draft lessons are edited by replacing rows (every change is in the audit log).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "subjects", "class_rooms", "timetables", "substitutions", "homework", "homework_submissions", "diary_notes", "diary_acks" FROM eduerp_app;
    REVOKE TRUNCATE ON "level_subjects", "section_subject_teachers", "student_subjects", "timetable_entries" FROM eduerp_app;
  END IF;
END $$;
