






-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'VALIDATED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ(6),
    "committed_by" UUID,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "errors" JSONB,
    "status" VARCHAR(10) NOT NULL,
    "entity_id" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "endpoint" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_created_at_idx" ON "import_jobs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_tenant_id_id_key" ON "import_jobs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_job_id_row_no_key" ON "import_rows"("job_id", "row_no");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_key_endpoint_key" ON "idempotency_keys"("tenant_id", "key", "endpoint");

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_job_id_fkey" FOREIGN KEY ("tenant_id", "job_id") REFERENCES "import_jobs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

ALTER TABLE "import_jobs" ADD CONSTRAINT import_jobs_status_chk CHECK (status IN ('VALIDATED','COMMITTED','CANCELLED'));
ALTER TABLE "import_jobs" ADD CONSTRAINT import_jobs_counts_chk CHECK (total_rows >= 0 AND valid_rows >= 0 AND error_rows >= 0 AND imported_rows >= 0 AND valid_rows + error_rows = total_rows);
ALTER TABLE "import_rows" ADD CONSTRAINT import_rows_status_chk CHECK (status IN ('VALID','INVALID','IMPORTED','SKIPPED'));
ALTER TABLE "idempotency_keys" ADD CONSTRAINT idempotency_keys_status_chk CHECK (status IN ('IN_PROGRESS','DONE'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_jobs','import_rows','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Import history is kept; rows are never deleted by the app.
    REVOKE DELETE, TRUNCATE ON "import_jobs", "import_rows" FROM eduerp_app;
  END IF;
END $$;
