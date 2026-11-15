






-- CreateTable
CREATE TABLE "education_boards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "board_type" VARCHAR(20) NOT NULL,
    "grading_system" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "education_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "board_id" UUID,
    "department_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "program_type" VARCHAR(20) NOT NULL,
    "stream" VARCHAR(50),
    "duration_levels" SMALLINT NOT NULL,
    "level_label" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "program_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "room" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "education_boards_tenant_id_id_key" ON "education_boards"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "education_boards_tenant_id_name_key" ON "education_boards"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "programs_tenant_id_id_key" ON "programs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_tenant_id_campus_id_code_key" ON "programs"("tenant_id", "campus_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "program_levels_tenant_id_id_key" ON "program_levels"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "program_levels_program_id_sequence_key" ON "program_levels"("program_id", "sequence");

-- CreateIndex
CREATE INDEX "sections_tenant_id_academic_year_id_campus_id_idx" ON "sections"("tenant_id", "academic_year_id", "campus_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_tenant_id_id_key" ON "sections"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_tenant_id_academic_year_id_program_level_id_name_key" ON "sections"("tenant_id", "academic_year_id", "program_level_id", "name");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_board_id_fkey" FOREIGN KEY ("tenant_id", "board_id") REFERENCES "education_boards"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_levels" ADD CONSTRAINT "program_levels_tenant_id_program_id_fkey" FOREIGN KEY ("tenant_id", "program_id") REFERENCES "programs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_id_academic_year_id_fkey" FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_id_program_level_id_fkey" FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "education_boards" ADD CONSTRAINT education_boards_type_chk CHECK (board_type IN ('SCHOOL_BOARD','PU_BOARD','UNIVERSITY'));
ALTER TABLE "education_boards" ADD CONSTRAINT education_boards_grading_chk CHECK (grading_system IN ('MARKS','GRADES','CBCS'));
ALTER TABLE "programs" ADD CONSTRAINT programs_type_chk CHECK (program_type IN ('SCHOOL','PU','UG','PG','DIPLOMA'));
ALTER TABLE "programs" ADD CONSTRAINT programs_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "programs" ADD CONSTRAINT programs_duration_chk CHECK (duration_levels BETWEEN 1 AND 15);
ALTER TABLE "program_levels" ADD CONSTRAINT program_levels_sequence_chk CHECK (sequence >= 1);
ALTER TABLE "sections" ADD CONSTRAINT sections_capacity_chk CHECK (capacity BETWEEN 1 AND 500);
ALTER TABLE "sections" ADD CONSTRAINT sections_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
-- Exactly one final level per programme.
CREATE UNIQUE INDEX program_levels_final_uq ON "program_levels" (program_id) WHERE is_final;

-- No new sections in a closed academic year, whatever the application does.
CREATE OR REPLACE FUNCTION sections_open_year() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM academic_years y WHERE y.id = NEW.academic_year_id AND y.status = 'CLOSED') THEN
    RAISE EXCEPTION 'academic_year_closed: sections cannot be added to a closed academic year' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sections_open_year_trg BEFORE INSERT ON "sections" FOR EACH ROW EXECUTE FUNCTION sections_open_year();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['education_boards','programs','program_levels','sections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Structure is deactivated, never deleted (students and history point at it).
    REVOKE DELETE, TRUNCATE ON "programs", "program_levels", "sections" FROM eduerp_app;
  END IF;
END $$;
