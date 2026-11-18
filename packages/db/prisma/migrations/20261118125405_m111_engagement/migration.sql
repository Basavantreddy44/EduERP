-- CreateTable
CREATE TABLE "feed_posts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "post_type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200),
    "body" VARCHAR(5000) NOT NULL,
    "file_ids" UUID[],
    "event_id" UUID,
    "allow_comments" BOOLEAN NOT NULL DEFAULT true,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    "approved_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feed_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_targets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "target_type" VARCHAR(10) NOT NULL,
    "target_id" UUID,

    CONSTRAINT "feed_post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_reactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reaction" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_comments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_comment_id" UUID,
    "comment" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'VISIBLE',
    "moderated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feed_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "post_id" UUID,
    "comment_id" UUID,
    "reported_by" UUID NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "details" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feed_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "event_type" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "venue" VARCHAR(200),
    "organiser_employee_id" UUID,
    "registration_required" BOOLEAN NOT NULL DEFAULT false,
    "max_participants" INTEGER,
    "requires_consent" BOOLEAN NOT NULL DEFAULT false,
    "fee_head_id" UUID,
    "fee_amount" DECIMAL(14,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_targets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "target_type" VARCHAR(10) NOT NULL,
    "target_id" UUID,

    CONSTRAINT "event_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "response" VARCHAR(12) NOT NULL,
    "consent_by" UUID,
    "invoice_id" UUID,
    "attended" BOOLEAN,
    "responded_by" UUID NOT NULL,
    "responded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ptm_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "ptm_date" DATE NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "slot_minutes" SMALLINT NOT NULL,
    "mode" VARCHAR(10) NOT NULL DEFAULT 'IN_PERSON',
    "booking_opens" TIMESTAMPTZ(6) NOT NULL,
    "booking_closes" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ptm_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ptm_session_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "program_level_id" UUID NOT NULL,

    CONSTRAINT "ptm_session_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ptm_slots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "slot_start" VARCHAR(5) NOT NULL,
    "slot_end" VARCHAR(5) NOT NULL,
    "room" VARCHAR(30),
    "meeting_link" VARCHAR(500),
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ptm_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ptm_bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "booked_by" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'BOOKED',
    "teacher_notes" VARCHAR(2000),
    "parent_feedback" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ptm_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_posts_tenant_id_status_published_at_idx" ON "feed_posts"("tenant_id", "status", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feed_posts_tenant_id_id_key" ON "feed_posts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "feed_post_targets_tenant_id_target_type_target_id_idx" ON "feed_post_targets"("tenant_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "feed_reactions_tenant_id_post_id_user_id_key" ON "feed_reactions"("tenant_id", "post_id", "user_id");

-- CreateIndex
CREATE INDEX "feed_comments_tenant_id_post_id_created_at_idx" ON "feed_comments"("tenant_id", "post_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feed_comments_tenant_id_id_key" ON "feed_comments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "feed_reports_tenant_id_status_idx" ON "feed_reports"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "events_tenant_id_start_date_idx" ON "events"("tenant_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "events_tenant_id_id_key" ON "events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "event_participants_tenant_id_event_id_student_id_key" ON "event_participants"("tenant_id", "event_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "ptm_sessions_tenant_id_id_key" ON "ptm_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ptm_session_levels_tenant_id_session_id_program_level_id_key" ON "ptm_session_levels"("tenant_id", "session_id", "program_level_id");

-- CreateIndex
CREATE UNIQUE INDEX "ptm_slots_tenant_id_id_key" ON "ptm_slots"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ptm_slots_tenant_id_session_id_employee_id_slot_start_key" ON "ptm_slots"("tenant_id", "session_id", "employee_id", "slot_start");

-- CreateIndex
CREATE INDEX "ptm_bookings_tenant_id_student_id_idx" ON "ptm_bookings"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "ptm_bookings_tenant_id_id_key" ON "ptm_bookings"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "feed_post_targets" ADD CONSTRAINT "feed_post_targets_tenant_id_post_id_fkey" FOREIGN KEY ("tenant_id", "post_id") REFERENCES "feed_posts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_tenant_id_post_id_fkey" FOREIGN KEY ("tenant_id", "post_id") REFERENCES "feed_posts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_tenant_id_post_id_fkey" FOREIGN KEY ("tenant_id", "post_id") REFERENCES "feed_posts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_targets" ADD CONSTRAINT "event_targets_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ptm_session_levels" ADD CONSTRAINT "ptm_session_levels_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "ptm_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ptm_slots" ADD CONSTRAINT "ptm_slots_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "ptm_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ptm_bookings" ADD CONSTRAINT "ptm_bookings_tenant_id_slot_id_fkey" FOREIGN KEY ("tenant_id", "slot_id") REFERENCES "ptm_slots"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Links to existing tables (kept out of schema.prisma).
ALTER TABLE "feed_posts" ADD CONSTRAINT feed_posts_author_fkey FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "feed_posts" ADD CONSTRAINT feed_posts_event_fkey FOREIGN KEY ("tenant_id", "event_id") REFERENCES "events"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "feed_reactions" ADD CONSTRAINT feed_reactions_user_fkey FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "feed_comments" ADD CONSTRAINT feed_comments_user_fkey FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "feed_comments" ADD CONSTRAINT feed_comments_parent_fkey FOREIGN KEY ("tenant_id", "parent_comment_id") REFERENCES "feed_comments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "feed_reports" ADD CONSTRAINT feed_reports_post_fkey FOREIGN KEY ("tenant_id", "post_id") REFERENCES "feed_posts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "feed_reports" ADD CONSTRAINT feed_reports_comment_fkey FOREIGN KEY ("tenant_id", "comment_id") REFERENCES "feed_comments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "events" ADD CONSTRAINT events_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "events" ADD CONSTRAINT events_organiser_fkey FOREIGN KEY ("tenant_id", "organiser_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "events" ADD CONSTRAINT events_fee_head_fkey FOREIGN KEY ("tenant_id", "fee_head_id") REFERENCES "fee_heads"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "event_participants" ADD CONSTRAINT event_parts_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "event_participants" ADD CONSTRAINT event_parts_invoice_fkey FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "ptm_sessions" ADD CONSTRAINT ptm_sessions_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "ptm_sessions" ADD CONSTRAINT ptm_sessions_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "ptm_session_levels" ADD CONSTRAINT ptm_levels_level_fkey FOREIGN KEY ("tenant_id", "program_level_id") REFERENCES "program_levels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "ptm_slots" ADD CONSTRAINT ptm_slots_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "ptm_bookings" ADD CONSTRAINT ptm_bookings_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "ptm_bookings" ADD CONSTRAINT ptm_bookings_session_fkey FOREIGN KEY ("tenant_id", "session_id") REFERENCES "ptm_sessions"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "feed_posts" ADD CONSTRAINT feed_posts_type_chk CHECK (post_type IN ('NEWS','CIRCULAR','ACHIEVEMENT','EVENT','GALLERY'));
ALTER TABLE "feed_posts" ADD CONSTRAINT feed_posts_status_chk CHECK (status IN ('PENDING_APPROVAL','PUBLISHED','REJECTED','HIDDEN'));
ALTER TABLE "feed_posts" ADD CONSTRAINT feed_posts_published_chk CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL);
ALTER TABLE "feed_post_targets" ADD CONSTRAINT feed_targets_chk CHECK ((target_type = 'ALL') = (target_id IS NULL) AND target_type IN ('ALL','CAMPUS','LEVEL','SECTION'));
ALTER TABLE "feed_reactions" ADD CONSTRAINT feed_reactions_chk CHECK (reaction IN ('LIKE','LOVE','CLAP','CELEBRATE'));
ALTER TABLE "feed_comments" ADD CONSTRAINT feed_comments_status_chk CHECK (status IN ('VISIBLE','HIDDEN'));
ALTER TABLE "feed_reports" ADD CONSTRAINT feed_reports_chk CHECK ((post_id IS NULL) <> (comment_id IS NULL) AND reason IN ('SPAM','ABUSIVE','INAPPROPRIATE','PRIVACY','OTHER') AND status IN ('OPEN','ACTION_TAKEN','DISMISSED'));
ALTER TABLE "events" ADD CONSTRAINT events_type_chk CHECK (event_type IN ('CULTURAL','SPORTS','ACADEMIC','TRIP','CELEBRATION','WORKSHOP','OTHER'));
ALTER TABLE "events" ADD CONSTRAINT events_status_chk CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED'));
ALTER TABLE "events" ADD CONSTRAINT events_dates_chk CHECK (end_date >= start_date);
ALTER TABLE "events" ADD CONSTRAINT events_fee_chk CHECK ((fee_amount IS NULL OR (fee_amount > 0 AND fee_head_id IS NOT NULL)));
ALTER TABLE "event_targets" ADD CONSTRAINT event_targets_chk CHECK ((target_type = 'ALL') = (target_id IS NULL) AND target_type IN ('ALL','CAMPUS','LEVEL','SECTION'));
ALTER TABLE "event_participants" ADD CONSTRAINT event_parts_response_chk CHECK (response IN ('GOING','NOT_GOING'));
ALTER TABLE "ptm_sessions" ADD CONSTRAINT ptm_sessions_chk CHECK (end_time > start_time AND slot_minutes BETWEEN 5 AND 60 AND booking_closes > booking_opens AND mode IN ('IN_PERSON','ONLINE','BOTH') AND status IN ('OPEN','CANCELLED'));
ALTER TABLE "ptm_slots" ADD CONSTRAINT ptm_slots_chk CHECK (slot_end > slot_start);
ALTER TABLE "ptm_bookings" ADD CONSTRAINT ptm_bookings_status_chk CHECK (status IN ('BOOKED','CANCELLED','ATTENDED','NO_SHOW'));

-- One family per slot, and one meeting per student with each teacher on a PTM day (cancelled ones free the place).
CREATE UNIQUE INDEX ptm_bookings_slot_uq ON "ptm_bookings" ("tenant_id", "slot_id") WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX ptm_bookings_student_teacher_uq ON "ptm_bookings" ("tenant_id", "session_id", "employee_id", "student_id") WHERE status <> 'CANCELLED';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['feed_posts','feed_post_targets','feed_reactions','feed_comments','feed_reports','events','event_targets','event_participants','ptm_sessions','ptm_session_levels','ptm_slots','ptm_bookings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted; a reaction can be taken back (its row removed) — nothing else.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "feed_posts", "feed_post_targets", "feed_comments", "feed_reports", "events", "event_targets", "event_participants", "ptm_sessions", "ptm_session_levels", "ptm_slots", "ptm_bookings" FROM eduerp_app;
    REVOKE TRUNCATE ON "feed_reactions" FROM eduerp_app;
  END IF;
END $$;
