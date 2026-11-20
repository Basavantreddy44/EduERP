-- CreateTable
CREATE TABLE "labs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "department_id" UUID,
    "incharge_employee_id" UUID,
    "lab_assistant_employee_id" UUID,
    "store_id" UUID,
    "capacity" SMALLINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "labs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "item_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "asset_tag" VARCHAR(50) NOT NULL,
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "condition" VARCHAR(20) NOT NULL DEFAULT 'WORKING',
    "last_calibration_date" DATE,
    "next_calibration_date" DATE,
    "notes" VARCHAR(300),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID,
    "batch_name" VARCHAR(20),
    "employee_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "experiment_title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "students_present" SMALLINT,
    "remarks" VARCHAR(300),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_breakages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "equipment_id" UUID,
    "session_id" UUID,
    "item_description" VARCHAR(200) NOT NULL,
    "student_id" UUID,
    "breakage_date" DATE NOT NULL,
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "charge_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fee_invoice_id" UUID,
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REPORTED',
    "waive_reason" VARCHAR(300),
    "remarks" VARCHAR(300),
    "reported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lab_breakages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "activity_type" VARCHAR(10) NOT NULL,
    "coordinator_employee_id" UUID,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "team_name" VARCHAR(50),
    "member_role" VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "event_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "venue" VARCHAR(200),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "description" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL DEFAULT '',
    "result" VARCHAR(20) NOT NULL DEFAULT 'PARTICIPATED',
    "remarks" VARCHAR(200),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competition_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "achievement_date" DATE NOT NULL,
    "competition_participant_id" UUID,
    "description" VARCHAR(500),
    "feed_post_id" UUID,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labs_tenant_id_id_key" ON "labs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "labs_tenant_id_campus_id_name_key" ON "labs"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE INDEX "lab_equipment_tenant_id_lab_id_idx" ON "lab_equipment"("tenant_id", "lab_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_equipment_tenant_id_id_key" ON "lab_equipment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_equipment_tenant_id_asset_tag_key" ON "lab_equipment"("tenant_id", "asset_tag");

-- CreateIndex
CREATE INDEX "lab_sessions_tenant_id_lab_id_session_date_idx" ON "lab_sessions"("tenant_id", "lab_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "lab_sessions_tenant_id_id_key" ON "lab_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "lab_breakages_tenant_id_lab_id_idx" ON "lab_breakages"("tenant_id", "lab_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_breakages_tenant_id_id_key" ON "lab_breakages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_tenant_id_id_key" ON "activities"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_tenant_id_campus_id_name_key" ON "activities"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE INDEX "activity_members_tenant_id_student_id_idx" ON "activity_members"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_members_tenant_id_id_key" ON "activity_members"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_members_tenant_id_activity_id_student_id_academic__key" ON "activity_members"("tenant_id", "activity_id", "student_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "competitions_tenant_id_activity_id_idx" ON "competitions"("tenant_id", "activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "competitions_tenant_id_id_key" ON "competitions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "competition_participants_tenant_id_student_id_idx" ON "competition_participants"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_participants_tenant_id_id_key" ON "competition_participants"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_participants_tenant_id_competition_id_student_i_key" ON "competition_participants"("tenant_id", "competition_id", "student_id", "category");

-- CreateIndex
CREATE INDEX "achievements_tenant_id_student_id_idx" ON "achievements"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_tenant_id_id_key" ON "achievements"("tenant_id", "id");

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links.
ALTER TABLE "labs" ADD CONSTRAINT labs_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "labs" ADD CONSTRAINT labs_department_fkey FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "labs" ADD CONSTRAINT labs_incharge_fkey FOREIGN KEY ("tenant_id", "incharge_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "labs" ADD CONSTRAINT labs_assistant_fkey FOREIGN KEY ("tenant_id", "lab_assistant_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "labs" ADD CONSTRAINT labs_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_equipment" ADD CONSTRAINT lab_equipment_lab_fkey FOREIGN KEY ("tenant_id", "lab_id") REFERENCES "labs"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_equipment" ADD CONSTRAINT lab_equipment_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_sessions" ADD CONSTRAINT lab_sessions_lab_fkey FOREIGN KEY ("tenant_id", "lab_id") REFERENCES "labs"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_sessions" ADD CONSTRAINT lab_sessions_section_fkey FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_sessions" ADD CONSTRAINT lab_sessions_subject_fkey FOREIGN KEY ("tenant_id", "subject_id") REFERENCES "subjects"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_sessions" ADD CONSTRAINT lab_sessions_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_lab_fkey FOREIGN KEY ("tenant_id", "lab_id") REFERENCES "labs"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_equipment_fkey FOREIGN KEY ("tenant_id", "equipment_id") REFERENCES "lab_equipment"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_session_fkey FOREIGN KEY ("tenant_id", "session_id") REFERENCES "lab_sessions"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_invoice_fkey FOREIGN KEY ("tenant_id", "fee_invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "activities" ADD CONSTRAINT activities_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "activities" ADD CONSTRAINT activities_coordinator_fkey FOREIGN KEY ("tenant_id", "coordinator_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "activity_members" ADD CONSTRAINT activity_members_activity_fkey FOREIGN KEY ("tenant_id", "activity_id") REFERENCES "activities"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "activity_members" ADD CONSTRAINT activity_members_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "activity_members" ADD CONSTRAINT activity_members_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "competitions" ADD CONSTRAINT competitions_activity_fkey FOREIGN KEY ("tenant_id", "activity_id") REFERENCES "activities"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "competitions" ADD CONSTRAINT competitions_event_fkey FOREIGN KEY ("tenant_id", "event_id") REFERENCES "events"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "competition_participants" ADD CONSTRAINT participants_competition_fkey FOREIGN KEY ("tenant_id", "competition_id") REFERENCES "competitions"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "competition_participants" ADD CONSTRAINT participants_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "achievements" ADD CONSTRAINT achievements_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "achievements" ADD CONSTRAINT achievements_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "achievements" ADD CONSTRAINT achievements_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "achievements" ADD CONSTRAINT achievements_participant_fkey FOREIGN KEY ("tenant_id", "competition_participant_id") REFERENCES "competition_participants"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "achievements" ADD CONSTRAINT achievements_feed_fkey FOREIGN KEY ("tenant_id", "feed_post_id") REFERENCES "feed_posts"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "labs" ADD CONSTRAINT labs_chk CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500);
ALTER TABLE "lab_equipment" ADD CONSTRAINT lab_equipment_chk CHECK (
  quantity >= 0 AND condition IN ('WORKING','NEEDS_REPAIR','DAMAGED','DISPOSED')
  AND (next_calibration_date IS NULL OR last_calibration_date IS NULL OR next_calibration_date >= last_calibration_date));
ALTER TABLE "lab_sessions" ADD CONSTRAINT lab_sessions_chk CHECK (
  status IN ('SCHEDULED','COMPLETED','CANCELLED')
  AND start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time > start_time
  AND (students_present IS NULL OR students_present >= 0));
-- A charged breakage always has its fee bill; a waived one its reason.
ALTER TABLE "lab_breakages" ADD CONSTRAINT lab_breakages_chk CHECK (
  status IN ('REPORTED','PENDING_APPROVAL','CHARGED','WAIVED') AND quantity > 0 AND charge_amount >= 0
  AND (status <> 'CHARGED' OR (fee_invoice_id IS NOT NULL AND student_id IS NOT NULL AND charge_amount > 0))
  AND (status <> 'WAIVED' OR waive_reason IS NOT NULL));
ALTER TABLE "activities" ADD CONSTRAINT activities_chk CHECK (activity_type IN ('SPORT','CLUB','HOUSE'));
ALTER TABLE "activity_members" ADD CONSTRAINT activity_members_chk CHECK (member_role IN ('MEMBER','CAPTAIN','VICE_CAPTAIN','SECRETARY'));
ALTER TABLE "competitions" ADD CONSTRAINT competitions_chk CHECK (
  level IN ('INTRA','INTER_SCHOOL','ZONAL','DISTRICT','STATE','NATIONAL','INTERNATIONAL') AND end_date >= start_date);
ALTER TABLE "competition_participants" ADD CONSTRAINT participants_chk CHECK (result IN ('PARTICIPATED','WINNER','RUNNER_UP','THIRD','SPECIAL'));
-- An achievement belongs to exactly one person; a verified one has who and when.
ALTER TABLE "achievements" ADD CONSTRAINT achievements_chk CHECK (
  category IN ('SPORTS','ACADEMIC','CULTURAL','NCC_NSS','OTHER')
  AND level IN ('INTRA','INTER_SCHOOL','ZONAL','DISTRICT','STATE','NATIONAL','INTERNATIONAL')
  AND ((student_id IS NULL) <> (employee_id IS NULL))
  AND (NOT is_verified OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)));
-- One achievement per competition result.
CREATE UNIQUE INDEX achievements_participant_uq ON "achievements" ("tenant_id", "competition_participant_id") WHERE competition_participant_id IS NOT NULL;

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['labs','lab_equipment','lab_sessions','lab_breakages','activities','activity_members','competitions','competition_participants','achievements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted (labs and activities are switched off, sessions cancelled, breakages waived).
-- Members, participants and unverified achievements entered by mistake may be removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "labs", "lab_equipment", "lab_sessions", "lab_breakages", "activities", "competitions" FROM eduerp_app;
  END IF;
END $$;
