-- CreateTable
CREATE TABLE "committees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "member_role" VARCHAR(20) NOT NULL,

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "meeting_type" VARCHAR(20) NOT NULL,
    "committee_id" UUID,
    "department_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "venue" VARCHAR(200),
    "meeting_link" VARCHAR(500),
    "organiser_user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "minutes_text" TEXT,
    "minutes_status" VARCHAR(20),
    "minutes_recorded_by" UUID,
    "minutes_approved_by" UUID,
    "minutes_approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "rsvp" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "attended" BOOLEAN,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_agenda_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "item_no" SMALLINT NOT NULL,
    "title" VARCHAR(300) NOT NULL,

    CONSTRAINT "meeting_agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_action_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "owner_employee_id" UUID NOT NULL,
    "due_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "note" VARCHAR(300),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "default_employee_id" UUID,
    "sla_hours" INTEGER NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "complaint_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "complaint_no" VARCHAR(30) NOT NULL,
    "category_id" UUID NOT NULL,
    "raised_by_user_id" UUID NOT NULL,
    "raised_by_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    "assigned_employee_id" UUID,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "escalated_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "rating" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_updates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "updated_by" UUID,
    "update_type" VARCHAR(20) NOT NULL,
    "message" VARCHAR(3000),
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "old_status" VARCHAR(20),
    "new_status" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "visitor_name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "id_proof_type" VARCHAR(20),
    "id_proof_last4" VARCHAR(4),
    "purpose" VARCHAR(20) NOT NULL,
    "purpose_note" VARCHAR(200),
    "whom_to_meet_employee_id" UUID,
    "student_id" UUID,
    "pass_no" VARCHAR(20) NOT NULL,
    "vehicle_no" VARCHAR(20),
    "in_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "out_time" TIMESTAMPTZ(6),
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_passes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "pass_no" VARCHAR(30) NOT NULL,
    "pass_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "reason" VARCHAR(300) NOT NULL,
    "pickup_guardian_id" UUID,
    "pickup_person_name" VARCHAR(150),
    "pickup_person_phone" VARCHAR(15),
    "expected_return" TIMESTAMPTZ(6),
    "out_time" TIMESTAMPTZ(6),
    "actual_return" TIMESTAMPTZ(6),
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gate_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "call_type" VARCHAR(10) NOT NULL,
    "caller_name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "purpose" VARCHAR(300) NOT NULL,
    "follow_up_date" DATE,
    "follow_up_done" BOOLEAN NOT NULL DEFAULT false,
    "call_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postal_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "from_party" VARCHAR(200) NOT NULL,
    "to_party" VARCHAR(200) NOT NULL,
    "courier_name" VARCHAR(100),
    "tracking_no" VARCHAR(50),
    "addressed_to_employee_id" UUID,
    "record_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handed_over_at" TIMESTAMPTZ(6),
    "remarks" VARCHAR(300),
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "postal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "to_department_id" UUID NOT NULL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "sla_hours" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "request_no" VARCHAR(30) NOT NULL,
    "from_department_id" UUID NOT NULL,
    "to_department_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(3000) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    "needed_by" DATE,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "approval_request_id" UUID,
    "assigned_employee_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "department_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_request_updates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "updated_by" UUID,
    "message" VARCHAR(2000),
    "old_status" VARCHAR(20),
    "new_status" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_request_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "committees_tenant_id_id_key" ON "committees"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "committees_tenant_id_name_key" ON "committees"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "committee_members_tenant_id_committee_id_employee_id_key" ON "committee_members"("tenant_id", "committee_id", "employee_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_start_at_idx" ON "meetings"("tenant_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_tenant_id_id_key" ON "meetings"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_tenant_id_meeting_id_employee_id_key" ON "meeting_participants"("tenant_id", "meeting_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_agenda_items_tenant_id_meeting_id_item_no_key" ON "meeting_agenda_items"("tenant_id", "meeting_id", "item_no");

-- CreateIndex
CREATE INDEX "meeting_action_items_tenant_id_owner_employee_id_status_idx" ON "meeting_action_items"("tenant_id", "owner_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_categories_tenant_id_id_key" ON "complaint_categories"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_categories_tenant_id_name_key" ON "complaint_categories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "complaints_tenant_id_status_due_at_idx" ON "complaints"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_tenant_id_id_key" ON "complaints"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_tenant_id_complaint_no_key" ON "complaints"("tenant_id", "complaint_no");

-- CreateIndex
CREATE INDEX "complaint_updates_tenant_id_complaint_id_created_at_idx" ON "complaint_updates"("tenant_id", "complaint_id", "created_at");

-- CreateIndex
CREATE INDEX "visitors_tenant_id_campus_id_in_time_idx" ON "visitors"("tenant_id", "campus_id", "in_time");

-- CreateIndex
CREATE INDEX "gate_passes_tenant_id_campus_id_created_at_idx" ON "gate_passes"("tenant_id", "campus_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "gate_passes_tenant_id_pass_no_key" ON "gate_passes"("tenant_id", "pass_no");

-- CreateIndex
CREATE INDEX "call_logs_tenant_id_campus_id_call_time_idx" ON "call_logs"("tenant_id", "campus_id", "call_time");

-- CreateIndex
CREATE INDEX "postal_records_tenant_id_campus_id_record_date_idx" ON "postal_records"("tenant_id", "campus_id", "record_date");

-- CreateIndex
CREATE UNIQUE INDEX "request_categories_tenant_id_id_key" ON "request_categories"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "request_categories_tenant_id_name_key" ON "request_categories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "department_requests_tenant_id_to_department_id_status_idx" ON "department_requests"("tenant_id", "to_department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "department_requests_tenant_id_id_key" ON "department_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "department_requests_tenant_id_request_no_key" ON "department_requests"("tenant_id", "request_no");

-- CreateIndex
CREATE INDEX "department_request_updates_tenant_id_request_id_created_at_idx" ON "department_request_updates"("tenant_id", "request_id", "created_at");

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_tenant_id_committee_id_fkey" FOREIGN KEY ("tenant_id", "committee_id") REFERENCES "committees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_tenant_id_meeting_id_fkey" FOREIGN KEY ("tenant_id", "meeting_id") REFERENCES "meetings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_tenant_id_meeting_id_fkey" FOREIGN KEY ("tenant_id", "meeting_id") REFERENCES "meetings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_tenant_id_meeting_id_fkey" FOREIGN KEY ("tenant_id", "meeting_id") REFERENCES "meetings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "complaint_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_updates" ADD CONSTRAINT "complaint_updates_tenant_id_complaint_id_fkey" FOREIGN KEY ("tenant_id", "complaint_id") REFERENCES "complaints"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_requests" ADD CONSTRAINT "department_requests_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "request_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_request_updates" ADD CONSTRAINT "department_request_updates_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "department_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links to existing tables.
ALTER TABLE "committees" ADD CONSTRAINT committees_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "committee_members" ADD CONSTRAINT committee_members_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "meetings" ADD CONSTRAINT meetings_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "meetings" ADD CONSTRAINT meetings_committee_fkey FOREIGN KEY ("tenant_id", "committee_id") REFERENCES "committees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "meetings" ADD CONSTRAINT meetings_department_fkey FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "meetings" ADD CONSTRAINT meetings_organiser_fkey FOREIGN KEY ("organiser_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "meeting_participants" ADD CONSTRAINT meeting_parts_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "meeting_action_items" ADD CONSTRAINT meeting_actions_owner_fkey FOREIGN KEY ("tenant_id", "owner_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "complaint_categories" ADD CONSTRAINT complaint_cats_handler_fkey FOREIGN KEY ("tenant_id", "default_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "complaints" ADD CONSTRAINT complaints_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "complaints" ADD CONSTRAINT complaints_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "complaints" ADD CONSTRAINT complaints_handler_fkey FOREIGN KEY ("tenant_id", "assigned_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "complaints" ADD CONSTRAINT complaints_raiser_fkey FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "visitors" ADD CONSTRAINT visitors_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "visitors" ADD CONSTRAINT visitors_staff_fkey FOREIGN KEY ("tenant_id", "whom_to_meet_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "visitors" ADD CONSTRAINT visitors_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "gate_passes" ADD CONSTRAINT gate_passes_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "gate_passes" ADD CONSTRAINT gate_passes_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "gate_passes" ADD CONSTRAINT gate_passes_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "gate_passes" ADD CONSTRAINT gate_passes_guardian_fkey FOREIGN KEY ("tenant_id", "pickup_guardian_id") REFERENCES "guardians"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "call_logs" ADD CONSTRAINT call_logs_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "postal_records" ADD CONSTRAINT postal_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "postal_records" ADD CONSTRAINT postal_staff_fkey FOREIGN KEY ("tenant_id", "addressed_to_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "request_categories" ADD CONSTRAINT request_cats_dept_fkey FOREIGN KEY ("tenant_id", "to_department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "department_requests" ADD CONSTRAINT dept_requests_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "department_requests" ADD CONSTRAINT dept_requests_from_fkey FOREIGN KEY ("tenant_id", "from_department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "department_requests" ADD CONSTRAINT dept_requests_to_fkey FOREIGN KEY ("tenant_id", "to_department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "department_requests" ADD CONSTRAINT dept_requests_assignee_fkey FOREIGN KEY ("tenant_id", "assigned_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "committee_members" ADD CONSTRAINT committee_members_role_chk CHECK (member_role IN ('CHAIR','SECRETARY','MEMBER'));
ALTER TABLE "meetings" ADD CONSTRAINT meetings_chk CHECK (end_at > start_at AND meeting_type IN ('STAFF','DEPARTMENT','COMMITTEE','MANAGEMENT','OTHER') AND status IN ('SCHEDULED','COMPLETED','CANCELLED') AND (minutes_status IS NULL OR minutes_status IN ('DRAFT','CIRCULATED','APPROVED')));
ALTER TABLE "meeting_participants" ADD CONSTRAINT meeting_parts_rsvp_chk CHECK (rsvp IN ('PENDING','ACCEPTED','DECLINED'));
ALTER TABLE "meeting_action_items" ADD CONSTRAINT meeting_actions_status_chk CHECK (status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED'));
ALTER TABLE "complaint_categories" ADD CONSTRAINT complaint_cats_sla_chk CHECK (sla_hours > 0);
ALTER TABLE "complaints" ADD CONSTRAINT complaints_chk CHECK (raised_by_type IN ('PARENT','STAFF','STUDENT') AND priority IN ('LOW','MEDIUM','HIGH','URGENT') AND status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED','REOPENED') AND (rating IS NULL OR rating BETWEEN 1 AND 5));
ALTER TABLE "complaint_updates" ADD CONSTRAINT complaint_updates_type_chk CHECK (update_type IN ('COMMENT','STATUS_CHANGE','ASSIGNMENT','ESCALATION'));
-- Only the last 4 characters of an identity document are ever stored.
ALTER TABLE "visitors" ADD CONSTRAINT visitors_id_last4_chk CHECK (id_proof_last4 IS NULL OR id_proof_last4 ~ '^[A-Z0-9]{4}$');
ALTER TABLE "visitors" ADD CONSTRAINT visitors_chk CHECK (purpose IN ('PARENT_VISIT','ADMISSION','VENDOR','INTERVIEW','OFFICIAL','OTHER') AND (out_time IS NULL OR out_time >= in_time));
ALTER TABLE "gate_passes" ADD CONSTRAINT gate_passes_chk CHECK (
  pass_type IN ('STUDENT','STAFF') AND (pass_type = 'STUDENT') = (student_id IS NOT NULL) AND (pass_type = 'STAFF') = (employee_id IS NOT NULL)
  AND status IN ('REQUESTED','APPROVED','REJECTED','OUT','RETURNED')
  AND (pass_type = 'STAFF' OR pickup_guardian_id IS NOT NULL OR pickup_person_name IS NOT NULL));
ALTER TABLE "call_logs" ADD CONSTRAINT call_logs_type_chk CHECK (call_type IN ('INCOMING','OUTGOING'));
ALTER TABLE "postal_records" ADD CONSTRAINT postal_direction_chk CHECK (direction IN ('INWARD','OUTWARD'));
ALTER TABLE "request_categories" ADD CONSTRAINT request_cats_sla_chk CHECK (sla_hours > 0);
ALTER TABLE "department_requests" ADD CONSTRAINT dept_requests_chk CHECK (from_department_id <> to_department_id AND priority IN ('LOW','MEDIUM','HIGH','URGENT') AND status IN ('PENDING_APPROVAL','REJECTED','OPEN','IN_PROGRESS','COMPLETED','CLOSED'));

-- Approved minutes never change.
CREATE OR REPLACE FUNCTION meetings_minutes_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.minutes_status = 'APPROVED' AND (NEW.minutes_text IS DISTINCT FROM OLD.minutes_text OR NEW.minutes_status IS DISTINCT FROM OLD.minutes_status OR NEW.minutes_approved_by IS DISTINCT FROM OLD.minutes_approved_by) THEN
    RAISE EXCEPTION 'Approved minutes cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER meetings_minutes_frozen BEFORE UPDATE ON "meetings" FOR EACH ROW EXECUTE FUNCTION meetings_minutes_frozen();

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['committees','committee_members','meetings','meeting_participants','meeting_agenda_items','meeting_action_items','complaint_categories','complaints','complaint_updates','visitors','gate_passes','call_logs','postal_records','request_categories','department_requests','department_request_updates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted; a committee's member list is replaced as a whole when it is edited.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "committees", "meetings", "meeting_participants", "meeting_agenda_items", "meeting_action_items", "complaint_categories", "complaints", "complaint_updates", "visitors", "gate_passes", "call_logs", "postal_records", "request_categories", "department_requests", "department_request_updates" FROM eduerp_app;
    REVOKE TRUNCATE ON "committee_members" FROM eduerp_app;
  END IF;
END $$;
