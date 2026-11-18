







-- CreateTable
CREATE TABLE "periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "period_id" UUID,
    "taken_by" UUID,
    "taken_by_user_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "remarks" VARCHAR(200),
    "parent_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "periods_tenant_id_campus_id_sequence_idx" ON "periods"("tenant_id", "campus_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "periods_tenant_id_id_key" ON "periods"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "attendance_sessions_tenant_id_attendance_date_idx" ON "attendance_sessions"("tenant_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_tenant_id_id_key" ON "attendance_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_student_id_attendance_date_idx" ON "attendance_records"("tenant_id", "student_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_student_id_key" ON "attendance_records"("session_id", "student_id");

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_section_id_fkey" FOREIGN KEY ("tenant_id", "section_id") REFERENCES "sections"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "periods"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "attendance_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "periods" ADD CONSTRAINT periods_time_chk CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time > start_time);
ALTER TABLE "periods" ADD CONSTRAINT periods_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
CREATE UNIQUE INDEX periods_campus_name_uq ON "periods" (tenant_id, campus_id, lower(name)) WHERE status = 'ACTIVE';

ALTER TABLE "attendance_sessions" ADD CONSTRAINT att_sessions_status_chk CHECK (status IN ('DRAFT','SUBMITTED','LOCKED'));
ALTER TABLE "attendance_sessions" ADD CONSTRAINT att_sessions_submitted_chk CHECK ((status = 'DRAFT') = (submitted_at IS NULL));
-- One sheet per section, day and period (daily sheets have no period).
CREATE UNIQUE INDEX att_sessions_daily_uq ON "attendance_sessions" (tenant_id, section_id, attendance_date) WHERE period_id IS NULL;
CREATE UNIQUE INDEX att_sessions_period_uq ON "attendance_sessions" (tenant_id, section_id, attendance_date, period_id) WHERE period_id IS NOT NULL;

ALTER TABLE "attendance_records" ADD CONSTRAINT att_records_status_chk CHECK (status IN ('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['periods','attendance_sessions','attendance_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Attendance is never deleted (changes after submission go through corrections, M3.3).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "attendance_sessions", "attendance_records" FROM eduerp_app;
  END IF;
END $$;

-- A submitted sheet's marks cannot change except through an approved correction (which sets app.attendance_correction).
CREATE OR REPLACE FUNCTION attendance_records_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM attendance_sessions WHERE id = NEW.session_id;
  IF st <> 'DRAFT' AND coalesce(current_setting('app.attendance_correction', true), '') <> 'on' THEN
    RAISE EXCEPTION 'attendance sheet is submitted; use a correction' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER attendance_records_guard_trg BEFORE INSERT OR UPDATE ON "attendance_records" FOR EACH ROW EXECUTE FUNCTION attendance_records_guard();
