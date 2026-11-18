







-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_code" VARCHAR(20) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80),
    "name_local" VARCHAR(150),
    "gender" VARCHAR(10) NOT NULL,
    "dob" DATE,
    "phone" VARCHAR(15),
    "email" VARCHAR(150),
    "department_id" UUID,
    "designation" VARCHAR(80),
    "employee_type" VARCHAR(20) NOT NULL,
    "joining_date" DATE NOT NULL,
    "left_on" DATE,
    "photo_file_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_tenant_id_campus_id_status_idx" ON "employees"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_id_key" ON "employees"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_user_id_key" ON "employees"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "employees" ADD CONSTRAINT employees_type_chk CHECK (employee_type IN ('TEACHING','NON_TEACHING','CONTRACT','VISITING'));
ALTER TABLE "employees" ADD CONSTRAINT employees_status_chk CHECK (status IN ('ACTIVE','ON_LEAVE','RESIGNED','TERMINATED'));
ALTER TABLE "employees" ADD CONSTRAINT employees_gender_chk CHECK (gender IN ('MALE','FEMALE','OTHER'));
ALTER TABLE "employees" ADD CONSTRAINT employees_left_chk CHECK ((status IN ('RESIGNED','TERMINATED')) = (left_on IS NOT NULL));
ALTER TABLE "employees" ADD CONSTRAINT employees_left_after_join_chk CHECK (left_on IS NULL OR left_on >= joining_date);
-- Fast name search for the staff list.
CREATE INDEX employees_name_trgm ON "employees" USING gin ((lower(first_name || ' ' || coalesce(last_name, ''))) gin_trgm_ops);

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employees" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Staff are never hard-deleted (they leave with a status).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "employees" FROM eduerp_app;
  END IF;
END $$;
