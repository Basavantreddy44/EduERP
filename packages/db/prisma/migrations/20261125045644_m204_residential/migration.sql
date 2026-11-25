

























































































































































































































































































































-- AlterTable

-- AlterTable
ALTER TABLE "health_checkups" ADD COLUMN     "camp_id" UUID,
ADD COLUMN     "dental" VARCHAR(100),
ADD COLUMN     "haemoglobin" DECIMAL(4,1),
ADD COLUMN     "referred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skin" VARCHAR(100),
ADD COLUMN     "vision" VARCHAR(30);

-- AlterTable

-- CreateTable
CREATE TABLE "student_allotments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "level_name" VARCHAR(50) NOT NULL,
    "entrance_reg_no" VARCHAR(30) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "gender" VARCHAR(10) NOT NULL,
    "dob" DATE NOT NULL,
    "category" VARCHAR(10),
    "quota" VARCHAR(60),
    "rank" INTEGER,
    "father_name" VARCHAR(150),
    "mother_name" VARCHAR(150),
    "parent_phone" VARCHAR(15) NOT NULL,
    "address" VARCHAR(500),
    "status" VARCHAR(15) NOT NULL DEFAULT 'ALLOTTED',
    "status_date" DATE,
    "status_reason" VARCHAR(300),
    "student_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "student_allotments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "person_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "from_campus_id" UUID NOT NULL,
    "to_campus_id" UUID NOT NULL,
    "transfer_date" DATE NOT NULL,
    "order_no" VARCHAR(60),
    "reason" VARCHAR(300) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_daily_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "note_date" DATE NOT NULL,
    "remarks" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "hostel_daily_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_camps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "camp_date" DATE NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "conducted_by" VARCHAR(200),
    "notes" VARCHAR(1000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "health_camps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_allotments_tenant_id_campus_id_status_idx" ON "student_allotments"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_allotments_tenant_id_academic_year_id_entrance_reg__key" ON "student_allotments"("tenant_id", "academic_year_id", "entrance_reg_no");

-- CreateIndex
CREATE INDEX "campus_transfers_tenant_id_transfer_date_idx" ON "campus_transfers"("tenant_id", "transfer_date");

-- CreateIndex
CREATE INDEX "campus_transfers_tenant_id_student_id_idx" ON "campus_transfers"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "campus_transfers_tenant_id_employee_id_idx" ON "campus_transfers"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_daily_notes_tenant_id_hostel_id_note_date_key" ON "hostel_daily_notes"("tenant_id", "hostel_id", "note_date");

-- CreateIndex
CREATE INDEX "health_camps_tenant_id_campus_id_camp_date_idx" ON "health_camps"("tenant_id", "campus_id", "camp_date");

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ───────────── Hand-written section (Phase 21 Residential edition) ─────────────
CREATE UNIQUE INDEX health_camps_tenant_id_id_key ON "health_camps"("tenant_id", "id");

-- Foreign keys (composite with tenant, as everywhere).
ALTER TABLE "student_allotments" ADD CONSTRAINT allotments_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_allotments" ADD CONSTRAINT allotments_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_allotments" ADD CONSTRAINT allotments_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "campus_transfers" ADD CONSTRAINT transfers_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "campus_transfers" ADD CONSTRAINT transfers_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "campus_transfers" ADD CONSTRAINT transfers_from_fkey FOREIGN KEY ("tenant_id", "from_campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "campus_transfers" ADD CONSTRAINT transfers_to_fkey FOREIGN KEY ("tenant_id", "to_campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_daily_notes" ADD CONSTRAINT hostel_notes_hostel_fkey FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "health_camps" ADD CONSTRAINT health_camps_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "health_checkups" ADD CONSTRAINT checkups_camp_fkey FOREIGN KEY ("tenant_id", "camp_id") REFERENCES "health_camps"("tenant_id", "id") ON DELETE RESTRICT;
-- One camp entry per child and camp.
CREATE UNIQUE INDEX health_checkups_camp_student_uq ON "health_checkups"("tenant_id", "camp_id", "student_id") WHERE camp_id IS NOT NULL;

-- Allowed values and shapes.
ALTER TABLE "student_allotments" ADD CONSTRAINT allotments_chk CHECK (
  status IN ('ALLOTTED','JOINED','NOT_REPORTED','CANCELLED') AND gender IN ('MALE','FEMALE','OTHER')
  AND (rank IS NULL OR rank > 0) AND ((status = 'JOINED') = (student_id IS NOT NULL))
  AND (status = 'ALLOTTED' OR status_date IS NOT NULL));
ALTER TABLE "campus_transfers" ADD CONSTRAINT transfers_chk CHECK (
  person_type IN ('STUDENT','STAFF') AND from_campus_id <> to_campus_id
  AND ((person_type = 'STUDENT' AND student_id IS NOT NULL AND employee_id IS NULL) OR (person_type = 'STAFF' AND employee_id IS NOT NULL AND student_id IS NULL)));
ALTER TABLE "health_camps" ADD CONSTRAINT health_camps_chk CHECK (status IN ('OPEN','CLOSED'));
ALTER TABLE "health_checkups" ADD CONSTRAINT checkups_hb_chk CHECK (haemoglobin IS NULL OR haemoglobin BETWEEN 3 AND 25);

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_allotments','campus_transfers','hostel_daily_notes','health_camps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Allotments and moves are history: never deleted by the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "student_allotments", "campus_transfers", "health_camps" FROM eduerp_app;
  END IF;
END $$;
