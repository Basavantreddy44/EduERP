-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_local" VARCHAR(200),
    "slug" VARCHAR(50) NOT NULL,
    "institution_type" VARCHAR(20) NOT NULL,
    "logo_file_id" UUID,
    "email" VARCHAR(150),
    "phone" VARCHAR(15),
    "website" VARCHAR(200),
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "district" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(6),
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    "default_language" VARCHAR(5) NOT NULL DEFAULT 'en',
    "status" VARCHAR(20) NOT NULL DEFAULT 'TRIAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campuses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_local" VARCHAR(200),
    "campus_type" VARCHAR(20) NOT NULL,
    "affiliation_no" VARCHAR(50),
    "udise_code" VARCHAR(20),
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "district" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(6),
    "phone" VARCHAR(15),
    "email" VARCHAR(150),
    "principal_employee_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150),
    "phone" VARCHAR(15),
    "password_hash" VARCHAR(255),
    "preferred_language" VARCHAR(5) NOT NULL DEFAULT 'en',
    "platform_role" VARCHAR(20),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tenants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "user_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "module_code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "campus_id" UUID,
    "department_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "device_info" VARCHAR(200),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "identifier" VARCHAR(150) NOT NULL,
    "login_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "success" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(100),

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "campus_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "reason" VARCHAR(300),
    "ip_address" VARCHAR(45),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "campuses_tenant_id_id_key" ON "campuses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "campuses_tenant_id_code_key" ON "campuses"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "user_tenants_user_id_idx" ON "user_tenants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenants_tenant_id_user_id_key" ON "user_tenants"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "roles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_user_id_idx" ON "user_roles"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "login_history_user_id_login_at_idx" ON "login_history"("user_id", "login_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ---------- Request context helpers ----------
-- The API sets these per transaction with set_config(..., true) (transaction-local).
-- Missing setting => NULL => tenant policies match no rows (fail closed).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.is_platform', true), '') = 'on' $$;
CREATE OR REPLACE FUNCTION app_login_identifier() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.login_identifier', true), '') $$;

-- ---------- CHECK constraints ----------
ALTER TABLE "tenants" ADD CONSTRAINT tenants_status_chk CHECK (status IN ('TRIAL','ACTIVE','GRACE','SUSPENDED','CLOSED'));
ALTER TABLE "tenants" ADD CONSTRAINT tenants_type_chk CHECK (institution_type IN ('SCHOOL','PU_COLLEGE','DEGREE_COLLEGE','UNIVERSITY','GROUP'));
ALTER TABLE "tenants" ADD CONSTRAINT tenants_lang_chk CHECK (default_language IN ('en','kn'));
ALTER TABLE "campuses" ADD CONSTRAINT campuses_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "campuses" ADD CONSTRAINT campuses_type_chk CHECK (campus_type IN ('SCHOOL','PU','DEGREE','PG','OTHER'));
ALTER TABLE "users" ADD CONSTRAINT users_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT users_status_chk CHECK (status IN ('ACTIVE','LOCKED','DISABLED'));
ALTER TABLE "users" ADD CONSTRAINT users_platform_role_chk CHECK (platform_role IS NULL OR platform_role IN ('SUPER_ADMIN','SUPPORT'));
ALTER TABLE "user_tenants" ADD CONSTRAINT user_tenants_type_chk CHECK (user_type IN ('STAFF','PARENT','STUDENT'));
ALTER TABLE "user_tenants" ADD CONSTRAINT user_tenants_status_chk CHECK (status IN ('INVITED','ACTIVE','REMOVED'));

-- One assignment per (user, role, campus, department); NULL campus = "all campuses" is a real value here.
CREATE UNIQUE INDEX user_roles_scope_uq ON "user_roles" (tenant_id, user_id, role_id, campus_id, department_id) NULLS NOT DISTINCT;

-- ---------- Row Level Security ----------
-- Plain tenant tables: only the current tenant's rows, for read AND write.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campuses','roles','role_permissions','user_roles','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Memberships: a tenant sees its members; a user also sees their own memberships (needed at login to list institutions).
ALTER TABLE "user_tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_tenants_read ON "user_tenants" FOR SELECT
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user());
CREATE POLICY user_tenants_write ON "user_tenants" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Tenants: the current tenant, tenants the current user belongs to, or everything for platform staff.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_read ON "tenants" FOR SELECT USING (
  id = app_current_tenant() OR app_is_platform()
  OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.tenant_id = tenants.id AND ut.user_id = app_current_user()));
CREATE POLICY tenants_insert ON "tenants" FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY tenants_update ON "tenants" FOR UPDATE
  USING (app_is_platform() OR id = app_current_tenant()) WITH CHECK (app_is_platform() OR id = app_current_tenant());

-- Users (global identity, PII): self, members of the current tenant, exact login/invite lookup, or platform staff.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY users_read ON "users" FOR SELECT USING (
  id = app_current_user() OR app_is_platform()
  OR email = app_login_identifier() OR phone = app_login_identifier()
  OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = users.id AND ut.tenant_id = app_current_tenant()));
CREATE POLICY users_insert ON "users" FOR INSERT WITH CHECK (true);
CREATE POLICY users_update ON "users" FOR UPDATE USING (
  id = app_current_user() OR app_is_platform()
  OR email = app_login_identifier() OR phone = app_login_identifier()
  OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = users.id AND ut.tenant_id = app_current_tenant()));

-- ---------- Runtime-role privileges ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Global masters are read-only for the app.
    REVOKE INSERT, UPDATE, DELETE ON "permissions" FROM eduerp_app;
    -- Audit log is append-only.
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM eduerp_app;
    -- No hard deletes on core records (status changes instead).
    REVOKE DELETE, TRUNCATE ON "tenants", "users", "campuses", "user_tenants", "login_history" FROM eduerp_app;
    -- Migration bookkeeping is not the app's business.
    REVOKE ALL ON "_prisma_migrations" FROM eduerp_app;
  END IF;
END $$;
