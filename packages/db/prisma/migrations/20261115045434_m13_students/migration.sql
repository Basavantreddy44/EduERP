






-- AlterTable
ALTER TABLE "student_enrollments" ADD COLUMN     "ended_on" DATE,
ADD COLUMN     "remarks" VARCHAR(300);

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "apaar_id" VARCHAR(12),
ADD COLUMN     "blood_group" VARCHAR(5);

-- CreateTable
CREATE TABLE "student_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "old_status" VARCHAR(20),
    "new_status" VARCHAR(20) NOT NULL,
    "effective_date" DATE NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_status_history_tenant_id_student_id_created_at_idx" ON "student_status_history"("tenant_id", "student_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_status_history_tenant_id_id_key" ON "student_status_history"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_student_id_idx" ON "student_enrollments"("tenant_id", "student_id");

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Enrolment history: a section change closes the old row as MOVED; leaving closes it as LEFT.
ALTER TABLE "student_enrollments" DROP CONSTRAINT enrollments_status_chk;
ALTER TABLE "student_enrollments" ADD CONSTRAINT enrollments_status_chk CHECK (status IN ('ACTIVE','PROMOTED','DETAINED','TRANSFERRED','CANCELLED','MOVED','LEFT'));
ALTER TABLE "student_enrollments" ADD CONSTRAINT enrollments_ended_chk CHECK (status NOT IN ('MOVED','LEFT') OR ended_on IS NOT NULL);
ALTER TABLE "student_enrollments" ADD CONSTRAINT enrollments_dates_chk CHECK (ended_on IS NULL OR ended_on >= enrolled_on);

ALTER TABLE "students" ADD CONSTRAINT students_blood_group_chk CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'));
ALTER TABLE "students" ADD CONSTRAINT students_apaar_chk CHECK (apaar_id ~ '^[0-9]{12}$');

ALTER TABLE "student_status_history" ADD CONSTRAINT status_history_new_chk CHECK (new_status IN ('ACTIVE','INACTIVE','TRANSFERRED','PASSED_OUT','DROPPED'));
ALTER TABLE "student_status_history" ADD CONSTRAINT status_history_reason_chk CHECK (length(reason) >= 3);

-- Student search (AC28): name (index from M1.2), admission number and parent phone, as substrings.
CREATE INDEX students_admission_no_trgm ON "students" USING gin ((lower(admission_no)) gin_trgm_ops);
CREATE INDEX guardians_phone_trgm ON "guardians" USING gin (phone gin_trgm_ops);

-- Students admitted before history existed get their "admitted" entry.
INSERT INTO "student_status_history" (id, tenant_id, student_id, old_status, new_status, effective_date, reason, created_at, created_by)
SELECT gen_random_uuid(), s.tenant_id, s.id, NULL, 'ACTIVE', s.admission_date, 'Admitted', s.created_at, s.created_by FROM "students" s;

ALTER TABLE "student_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_status_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "student_status_history" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Status history is permanent: no edits, no deletes.
    REVOKE UPDATE, DELETE, TRUNCATE ON "student_status_history" FROM eduerp_app;
  END IF;
END $$;
