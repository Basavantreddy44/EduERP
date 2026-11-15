
-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "setting_key" VARCHAR(80) NOT NULL,
    "setting_value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "doc_type" VARCHAR(30) NOT NULL,
    "prefix" VARCHAR(30) NOT NULL DEFAULT '',
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "padding" SMALLINT NOT NULL DEFAULT 5,
    "year_label" VARCHAR(10) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" UUID,
    "payload" JSONB NOT NULL,
    "dedupe_key" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "consumer" VARCHAR(80) NOT NULL,
    "event_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID,
    "doc_type" VARCHAR(50) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "event_code" VARCHAR(50) NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "provider_template_id" VARCHAR(80),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_code" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "recipient" VARCHAR(150) NOT NULL,
    "provider" VARCHAR(30),
    "provider_msg_id" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "error_message" VARCHAR(300),
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_code" VARCHAR(50) NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "entity_type" VARCHAR(40) NOT NULL,
    "min_amount" DECIMAL(14,2),
    "level_no" SMALLINT NOT NULL,
    "approver_role_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "amount" DECIMAL(14,2),
    "summary" VARCHAR(300),
    "requested_by" UUID NOT NULL,
    "current_level" SMALLINT NOT NULL DEFAULT 1,
    "total_levels" SMALLINT NOT NULL,
    "steps" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "level_no" SMALLINT NOT NULL,
    "action_by" UUID NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "remarks" VARCHAR(500),
    "action_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settings_tenant_id_setting_key_idx" ON "settings"("tenant_id", "setting_key");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_occurred_at_idx" ON "outbox_events"("status", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_tenant_id_entity_type_entity_id_idx" ON "files"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_tenant_id_id_key" ON "files"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_idx" ON "notifications"("tenant_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_id_key" ON "notifications"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "notification_deliveries_tenant_id_status_idx" ON "notification_deliveries"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_user_id_event_code_chann_key" ON "notification_preferences"("tenant_id", "user_id", "event_code", "channel");

-- CreateIndex
CREATE INDEX "approval_rules_tenant_id_entity_type_idx" ON "approval_rules"("tenant_id", "entity_type");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_idx" ON "approval_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_entity_type_entity_id_idx" ON "approval_requests"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_tenant_id_id_key" ON "approval_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_actions_approval_request_id_level_no_key" ON "approval_actions"("approval_request_id", "level_no");

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_notification_id_fkey" FOREIGN KEY ("tenant_id", "notification_id") REFERENCES "notifications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_tenant_id_approver_role_id_fkey" FOREIGN KEY ("tenant_id", "approver_role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_campus_id_fkey" FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_tenant_id_approval_request_id_fkey" FOREIGN KEY ("tenant_id", "approval_request_id") REFERENCES "approval_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ---------- Context helper: system worker ----------
-- The outbox relay reads PENDING events across tenants. It sets app.is_system = 'on' (transaction-local);
-- every handler then runs inside a normal tenant context. Like app.is_platform, this is set only by our code.
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.is_system', true), '') = 'on' $$;

-- ---------- Uniqueness where NULL campus means "institution-wide" ----------
CREATE UNIQUE INDEX settings_scope_uq ON "settings" (tenant_id, campus_id, setting_key) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX number_sequences_scope_uq ON "number_sequences" (tenant_id, campus_id, doc_type, year_label) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX notification_templates_uq ON "notification_templates" (tenant_id, event_code, channel, language) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX approval_rules_uq ON "approval_rules" (tenant_id, campus_id, entity_type, level_no, min_amount) NULLS NOT DISTINCT;
-- At most one open approval per business record.
CREATE UNIQUE INDEX approval_requests_open_uq ON "approval_requests" (tenant_id, entity_type, entity_id) WHERE status = 'PENDING';

-- ---------- CHECK constraints ----------
ALTER TABLE "number_sequences" ADD CONSTRAINT number_sequences_next_chk CHECK (next_number >= 1);
ALTER TABLE "number_sequences" ADD CONSTRAINT number_sequences_padding_chk CHECK (padding BETWEEN 1 AND 12);
ALTER TABLE "outbox_events" ADD CONSTRAINT outbox_events_status_chk CHECK (status IN ('PENDING','DISPATCHED','FAILED'));
ALTER TABLE "files" ADD CONSTRAINT files_status_chk CHECK (status IN ('ACTIVE','DELETED'));
ALTER TABLE "files" ADD CONSTRAINT files_size_chk CHECK (size_bytes > 0);
ALTER TABLE "notification_templates" ADD CONSTRAINT notification_templates_channel_chk CHECK (channel IN ('IN_APP','PUSH','SMS','WHATSAPP','EMAIL'));
ALTER TABLE "notification_templates" ADD CONSTRAINT notification_templates_lang_chk CHECK (language IN ('en','kn'));
ALTER TABLE "notification_deliveries" ADD CONSTRAINT notification_deliveries_channel_chk CHECK (channel IN ('IN_APP','PUSH','SMS','WHATSAPP','EMAIL'));
ALTER TABLE "notification_deliveries" ADD CONSTRAINT notification_deliveries_status_chk CHECK (status IN ('QUEUED','SENT','DELIVERED','READ','FAILED','SKIPPED'));
ALTER TABLE "notification_preferences" ADD CONSTRAINT notification_preferences_channel_chk CHECK (channel IN ('IN_APP','PUSH','SMS','WHATSAPP','EMAIL'));
ALTER TABLE "approval_rules" ADD CONSTRAINT approval_rules_level_chk CHECK (level_no BETWEEN 1 AND 5);
ALTER TABLE "approval_rules" ADD CONSTRAINT approval_rules_amount_chk CHECK (min_amount IS NULL OR min_amount >= 0);
ALTER TABLE "approval_requests" ADD CONSTRAINT approval_requests_status_chk CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE "approval_requests" ADD CONSTRAINT approval_requests_levels_chk CHECK (total_levels BETWEEN 1 AND 5 AND current_level BETWEEN 1 AND total_levels);
ALTER TABLE "approval_actions" ADD CONSTRAINT approval_actions_action_chk CHECK (action IN ('APPROVE','REJECT'));

-- ---------- Segregation of duties, enforced by the database too ----------
-- The person who raised a request can never act on it, whatever the application code does.
CREATE OR REPLACE FUNCTION approval_actions_sod() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM approval_requests r WHERE r.id = NEW.approval_request_id AND r.requested_by = NEW.action_by) THEN
    RAISE EXCEPTION 'approval_sod_violation: requester cannot act on own request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_actions_sod_trg BEFORE INSERT ON "approval_actions" FOR EACH ROW EXECUTE FUNCTION approval_actions_sod();

-- ---------- Row Level Security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings','number_sequences','processed_events','files','notifications','notification_deliveries',
                           'notification_preferences','approval_rules','approval_requests','approval_actions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Outbox: tenants write their own events; the system relay may read and update status across tenants.
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant ON "outbox_events"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY outbox_system_read ON "outbox_events" FOR SELECT USING (app_is_system());
CREATE POLICY outbox_system_update ON "outbox_events" FOR UPDATE USING (app_is_system()) WITH CHECK (app_is_system());

-- Templates: platform defaults (tenant_id NULL) are readable by every tenant; each tenant writes only its own overrides.
ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY templates_read ON "notification_templates" FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant());
CREATE POLICY templates_write ON "notification_templates" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- ---------- Runtime-role privileges ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    -- Decisions are history: no editing or deleting approval actions.
    REVOKE UPDATE, DELETE, TRUNCATE ON "approval_actions" FROM eduerp_app;
    -- Records with history are never hard-deleted (status changes instead).
    REVOKE DELETE, TRUNCATE ON "approval_requests", "files", "outbox_events", "notifications", "notification_deliveries", "processed_events" FROM eduerp_app;
  END IF;
END $$;
