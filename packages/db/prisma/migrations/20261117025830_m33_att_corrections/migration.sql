







-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "old_status" VARCHAR(10) NOT NULL,
    "new_status" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approval_request_id" UUID,
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_remarks" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_corrections_tenant_id_status_created_at_idx" ON "attendance_corrections"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "attendance_corrections_tenant_id_session_id_idx" ON "attendance_corrections"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_corrections_tenant_id_id_key" ON "attendance_corrections"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_tenant_id_id_key" ON "attendance_records"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_tenant_id_record_id_fkey" FOREIGN KEY ("tenant_id", "record_id") REFERENCES "attendance_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "attendance_corrections" ADD CONSTRAINT att_corr_status_chk CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE "attendance_corrections" ADD CONSTRAINT att_corr_new_chk CHECK (new_status IN ('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE') AND new_status <> old_status);
ALTER TABLE "attendance_corrections" ADD CONSTRAINT att_corr_decided_chk CHECK ((status = 'PENDING') = (decided_at IS NULL));
-- One open correction per mark.
CREATE UNIQUE INDEX att_corr_one_pending_uq ON "attendance_corrections" (record_id) WHERE status = 'PENDING';

ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_corrections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_corrections" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "attendance_corrections" FROM eduerp_app;
  END IF;
END $$;

-- Submitted marks: the mark and its note change only through an approved correction; recording that the
-- parent was told (parent_notified) is always allowed.
CREATE OR REPLACE FUNCTION attendance_records_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM attendance_sessions WHERE id = NEW.session_id;
  IF st = 'DRAFT' OR coalesce(current_setting('app.attendance_correction', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.remarks IS NOT DISTINCT FROM OLD.remarks
     AND NEW.session_id = OLD.session_id AND NEW.student_id = OLD.student_id AND NEW.attendance_date = OLD.attendance_date THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'attendance sheet is submitted; use a correction' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
