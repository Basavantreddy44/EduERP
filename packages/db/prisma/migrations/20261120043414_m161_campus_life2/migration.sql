-- CreateTable
CREATE TABLE "library_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_loan_days" SMALLINT NOT NULL DEFAULT 14,
    "staff_loan_days" SMALLINT NOT NULL DEFAULT 30,
    "student_max_books" SMALLINT NOT NULL DEFAULT 2,
    "staff_max_books" SMALLINT NOT NULL DEFAULT 5,
    "max_renewals" SMALLINT NOT NULL DEFAULT 1,
    "fine_per_day" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "grace_days" SMALLINT NOT NULL DEFAULT 0,
    "hold_days" SMALLINT NOT NULL DEFAULT 3,
    "next_accession" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_books" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "isbn" VARCHAR(20),
    "title" VARCHAR(300) NOT NULL,
    "authors" VARCHAR(300),
    "publisher" VARCHAR(150),
    "edition" VARCHAR(30),
    "publish_year" SMALLINT,
    "language" VARCHAR(30),
    "subject" VARCHAR(100),
    "call_no" VARCHAR(50),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_copies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "accession_no" VARCHAR(30) NOT NULL,
    "barcode" VARCHAR(50),
    "purchase_date" DATE,
    "price" DECIMAL(10,2),
    "rack_location" VARCHAR(50),
    "status" VARCHAR(15) NOT NULL DEFAULT 'AVAILABLE',
    "remarks" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_issues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "copy_id" UUID NOT NULL,
    "member_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "renew_count" SMALLINT NOT NULL DEFAULT 0,
    "return_date" DATE,
    "fine_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fine_status" VARCHAR(10) NOT NULL DEFAULT 'NONE',
    "fine_invoice_id" UUID,
    "lost_invoice_id" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ISSUED',
    "issued_by" UUID NOT NULL,
    "returned_to" UUID,
    "last_reminder" DATE,
    "remarks" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "member_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'WAITING',
    "copy_id" UUID,
    "ready_at" TIMESTAMPTZ(6),
    "expires_on" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_stock_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "started_on" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_stock_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_stock_scans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "copy_id" UUID NOT NULL,
    "scanned_by" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_stock_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_health_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "height_cm" DECIMAL(5,1),
    "weight_kg" DECIMAL(5,1),
    "allergies" VARCHAR(500),
    "conditions" VARCHAR(500),
    "medications" VARCHAR(500),
    "disability" VARCHAR(200),
    "doctor_name" VARCHAR(150),
    "doctor_phone" VARCHAR(15),
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_health_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infirmary_visits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "patient_type" VARCHAR(10) NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "visit_at" TIMESTAMPTZ(6) NOT NULL,
    "complaint" VARCHAR(300) NOT NULL,
    "temperature" DECIMAL(4,1),
    "treatment" VARCHAR(500),
    "medicine" VARCHAR(300),
    "outcome" VARCHAR(20) NOT NULL,
    "parent_informed" BOOLEAN NOT NULL DEFAULT false,
    "attended_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infirmary_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_checkups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "checkup_date" DATE NOT NULL,
    "checkup_type" VARCHAR(10) NOT NULL,
    "height_cm" DECIMAL(5,1),
    "weight_kg" DECIMAL(5,1),
    "findings" VARCHAR(1000) NOT NULL,
    "recommendation" VARCHAR(500),
    "doctor_name" VARCHAR(150),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_checkups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "vaccine_name" VARCHAR(100) NOT NULL,
    "dose_no" SMALLINT NOT NULL DEFAULT 1,
    "vaccination_date" DATE NOT NULL,
    "next_due_date" DATE,
    "remarks" VARCHAR(200),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discipline_incident_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "notify_parent" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discipline_incident_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discipline_incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "incident_at" TIMESTAMPTZ(6) NOT NULL,
    "location" VARCHAR(100),
    "description" VARCHAR(2000) NOT NULL,
    "witnesses" VARCHAR(300),
    "status" VARCHAR(15) NOT NULL DEFAULT 'REPORTED',
    "parent_notified" BOOLEAN NOT NULL DEFAULT false,
    "reported_by" UUID NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "closing_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discipline_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discipline_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "action_type" VARCHAR(15) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "from_date" DATE,
    "to_date" DATE,
    "fine_amount" DECIMAL(10,2),
    "fine_status" VARCHAR(20) NOT NULL DEFAULT 'NONE',
    "invoice_id" UUID,
    "approval_request_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discipline_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counselling_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "counsellor_id" UUID NOT NULL,
    "session_at" TIMESTAMPTZ(6) NOT NULL,
    "referral_source" VARCHAR(15) NOT NULL,
    "incident_id" UUID,
    "notes_enc" TEXT,
    "follow_up_date" DATE,
    "is_confidential" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "counselling_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "library_settings_tenant_id_key" ON "library_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "library_books_tenant_id_isbn_idx" ON "library_books"("tenant_id", "isbn");

-- CreateIndex
CREATE UNIQUE INDEX "library_books_tenant_id_id_key" ON "library_books"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "library_copies_tenant_id_book_id_idx" ON "library_copies"("tenant_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_copies_tenant_id_id_key" ON "library_copies"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "library_copies_tenant_id_accession_no_key" ON "library_copies"("tenant_id", "accession_no");

-- CreateIndex
CREATE INDEX "library_issues_tenant_id_status_due_date_idx" ON "library_issues"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "library_issues_tenant_id_student_id_idx" ON "library_issues"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "library_issues_tenant_id_employee_id_idx" ON "library_issues"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_issues_tenant_id_id_key" ON "library_issues"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "library_reservations_tenant_id_book_id_status_idx" ON "library_reservations"("tenant_id", "book_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "library_reservations_tenant_id_id_key" ON "library_reservations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "library_stock_checks_tenant_id_id_key" ON "library_stock_checks"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "library_stock_scans_tenant_id_id_key" ON "library_stock_scans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "library_stock_scans_check_id_copy_id_key" ON "library_stock_scans"("check_id", "copy_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_health_profiles_tenant_id_id_key" ON "student_health_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "student_health_profiles_tenant_id_student_id_key" ON "student_health_profiles"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "infirmary_visits_tenant_id_campus_id_visit_at_idx" ON "infirmary_visits"("tenant_id", "campus_id", "visit_at");

-- CreateIndex
CREATE INDEX "infirmary_visits_tenant_id_student_id_idx" ON "infirmary_visits"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "infirmary_visits_tenant_id_id_key" ON "infirmary_visits"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "health_checkups_tenant_id_student_id_idx" ON "health_checkups"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_checkups_tenant_id_id_key" ON "health_checkups"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "vaccinations_tenant_id_student_id_idx" ON "vaccinations"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "vaccinations_tenant_id_id_key" ON "vaccinations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discipline_incident_types_tenant_id_id_key" ON "discipline_incident_types"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discipline_incident_types_tenant_id_name_key" ON "discipline_incident_types"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "discipline_incidents_tenant_id_student_id_idx" ON "discipline_incidents"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "discipline_incidents_tenant_id_campus_id_status_idx" ON "discipline_incidents"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "discipline_incidents_tenant_id_id_key" ON "discipline_incidents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discipline_actions_tenant_id_id_key" ON "discipline_actions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "counselling_sessions_tenant_id_student_id_idx" ON "counselling_sessions"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "counselling_sessions_tenant_id_counsellor_id_idx" ON "counselling_sessions"("tenant_id", "counsellor_id");

-- CreateIndex
CREATE UNIQUE INDEX "counselling_sessions_tenant_id_id_key" ON "counselling_sessions"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_tenant_id_book_id_fkey" FOREIGN KEY ("tenant_id", "book_id") REFERENCES "library_books"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discipline_actions" ADD CONSTRAINT "discipline_actions_tenant_id_incident_id_fkey" FOREIGN KEY ("tenant_id", "incident_id") REFERENCES "discipline_incidents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links.
ALTER TABLE "library_copies" ADD CONSTRAINT library_copies_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_copy_fkey FOREIGN KEY ("tenant_id", "copy_id") REFERENCES "library_copies"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_fine_inv_fkey FOREIGN KEY ("tenant_id", "fine_invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_lost_inv_fkey FOREIGN KEY ("tenant_id", "lost_invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_reservations" ADD CONSTRAINT library_res_book_fkey FOREIGN KEY ("tenant_id", "book_id") REFERENCES "library_books"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_reservations" ADD CONSTRAINT library_res_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_reservations" ADD CONSTRAINT library_res_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_reservations" ADD CONSTRAINT library_res_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_reservations" ADD CONSTRAINT library_res_copy_fkey FOREIGN KEY ("tenant_id", "copy_id") REFERENCES "library_copies"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_stock_checks" ADD CONSTRAINT library_check_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_stock_scans" ADD CONSTRAINT library_scan_check_fkey FOREIGN KEY ("tenant_id", "check_id") REFERENCES "library_stock_checks"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "library_stock_scans" ADD CONSTRAINT library_scan_copy_fkey FOREIGN KEY ("tenant_id", "copy_id") REFERENCES "library_copies"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_health_profiles" ADD CONSTRAINT health_profile_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "infirmary_visits" ADD CONSTRAINT infirmary_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "infirmary_visits" ADD CONSTRAINT infirmary_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "infirmary_visits" ADD CONSTRAINT infirmary_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "health_checkups" ADD CONSTRAINT checkups_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vaccinations" ADD CONSTRAINT vaccinations_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "discipline_incidents" ADD CONSTRAINT incidents_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "discipline_incidents" ADD CONSTRAINT incidents_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "discipline_incidents" ADD CONSTRAINT incidents_type_fkey FOREIGN KEY ("tenant_id", "type_id") REFERENCES "discipline_incident_types"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "discipline_actions" ADD CONSTRAINT actions_invoice_fkey FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "counselling_sessions" ADD CONSTRAINT counselling_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "counselling_sessions" ADD CONSTRAINT counselling_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "counselling_sessions" ADD CONSTRAINT counselling_incident_fkey FOREIGN KEY ("tenant_id", "incident_id") REFERENCES "discipline_incidents"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "library_settings" ADD CONSTRAINT library_settings_chk CHECK (student_loan_days BETWEEN 1 AND 365 AND staff_loan_days BETWEEN 1 AND 365 AND student_max_books BETWEEN 0 AND 50 AND staff_max_books BETWEEN 0 AND 50 AND max_renewals BETWEEN 0 AND 20 AND fine_per_day >= 0 AND grace_days BETWEEN 0 AND 60 AND hold_days BETWEEN 1 AND 30 AND next_accession >= 1);
ALTER TABLE "library_books" ADD CONSTRAINT library_books_chk CHECK (publish_year IS NULL OR publish_year BETWEEN 1000 AND 2100);
ALTER TABLE "library_copies" ADD CONSTRAINT library_copies_chk CHECK (status IN ('AVAILABLE','ISSUED','ON_HOLD','LOST','DAMAGED','WITHDRAWN') AND (price IS NULL OR price >= 0));
CREATE UNIQUE INDEX library_copies_barcode_uq ON "library_copies" ("tenant_id", "barcode") WHERE barcode IS NOT NULL;
ALTER TABLE "library_issues" ADD CONSTRAINT library_issues_chk CHECK (
  member_type IN ('STUDENT','EMPLOYEE') AND (member_type = 'STUDENT') = (student_id IS NOT NULL) AND (member_type = 'EMPLOYEE') = (employee_id IS NOT NULL)
  AND status IN ('ISSUED','RETURNED','LOST') AND due_date >= issue_date AND renew_count >= 0
  AND (status = 'ISSUED') = (return_date IS NULL) AND (return_date IS NULL OR return_date >= issue_date)
  AND fine_amount >= 0 AND fine_status IN ('NONE','CHARGED','WAIVED') AND (fine_status <> 'CHARGED' OR fine_invoice_id IS NOT NULL));
-- A copy is never out to two people at once.
CREATE UNIQUE INDEX library_issues_copy_out_uq ON "library_issues" ("tenant_id", "copy_id") WHERE status = 'ISSUED';
ALTER TABLE "library_reservations" ADD CONSTRAINT library_res_chk CHECK (
  member_type IN ('STUDENT','EMPLOYEE') AND (member_type = 'STUDENT') = (student_id IS NOT NULL) AND (member_type = 'EMPLOYEE') = (employee_id IS NOT NULL)
  AND status IN ('WAITING','READY','COLLECTED','CANCELLED','EXPIRED') AND (status <> 'READY' OR (copy_id IS NOT NULL AND expires_on IS NOT NULL)));
-- One live reservation per person and book; one copy held for one reservation.
CREATE UNIQUE INDEX library_res_live_uq ON "library_reservations" ("tenant_id", "book_id", COALESCE(student_id, employee_id)) WHERE status IN ('WAITING','READY');
CREATE UNIQUE INDEX library_res_copy_uq ON "library_reservations" ("tenant_id", "copy_id") WHERE status = 'READY';
ALTER TABLE "library_stock_checks" ADD CONSTRAINT library_check_chk CHECK (status IN ('OPEN','CLOSED') AND (status = 'CLOSED') = (closed_at IS NOT NULL));
CREATE UNIQUE INDEX library_check_open_uq ON "library_stock_checks" ("tenant_id", "campus_id") WHERE status = 'OPEN';
ALTER TABLE "student_health_profiles" ADD CONSTRAINT health_profile_chk CHECK ((height_cm IS NULL OR height_cm BETWEEN 30 AND 250) AND (weight_kg IS NULL OR weight_kg BETWEEN 2 AND 250));
ALTER TABLE "infirmary_visits" ADD CONSTRAINT infirmary_chk CHECK (
  patient_type IN ('STUDENT','EMPLOYEE') AND (patient_type = 'STUDENT') = (student_id IS NOT NULL) AND (patient_type = 'EMPLOYEE') = (employee_id IS NOT NULL)
  AND outcome IN ('RETURNED_TO_CLASS','REST','SENT_HOME','HOSPITAL_REFERRED') AND (temperature IS NULL OR temperature BETWEEN 90 AND 110));
ALTER TABLE "health_checkups" ADD CONSTRAINT checkups_chk CHECK (checkup_type IN ('GENERAL','DENTAL','EYE','BMI') AND (height_cm IS NULL OR height_cm BETWEEN 30 AND 250) AND (weight_kg IS NULL OR weight_kg BETWEEN 2 AND 250));
ALTER TABLE "vaccinations" ADD CONSTRAINT vaccinations_chk CHECK (dose_no BETWEEN 1 AND 10 AND (next_due_date IS NULL OR next_due_date > vaccination_date));
ALTER TABLE "discipline_incident_types" ADD CONSTRAINT incident_types_chk CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'));
ALTER TABLE "discipline_incidents" ADD CONSTRAINT incidents_chk CHECK (status IN ('REPORTED','UNDER_REVIEW','ACTION_TAKEN','CLOSED') AND (status = 'CLOSED') = (closed_at IS NOT NULL));
ALTER TABLE "discipline_actions" ADD CONSTRAINT actions_chk CHECK (
  action_type IN ('WARNING','PARENT_MEETING','SUSPENSION','FINE','COUNSELLING','OTHER')
  AND (action_type <> 'SUSPENSION' OR (from_date IS NOT NULL AND to_date IS NOT NULL AND to_date >= from_date))
  AND (action_type = 'FINE') = (fine_amount IS NOT NULL) AND (fine_amount IS NULL OR fine_amount > 0)
  AND fine_status IN ('NONE','PENDING_APPROVAL','CHARGED','WAIVED') AND (fine_status <> 'CHARGED' OR invoice_id IS NOT NULL));
-- Counselling notes are stored only encrypted (CD-84).
ALTER TABLE "counselling_sessions" ADD CONSTRAINT counselling_chk CHECK (referral_source IN ('SELF','TEACHER','PARENT','DISCIPLINE','OTHER') AND (notes_enc IS NULL OR notes_enc LIKE 'v1:%'));

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['library_settings','library_books','library_copies','library_issues','library_reservations','library_stock_checks','library_stock_scans','student_health_profiles','infirmary_visits','health_checkups','vaccinations','discipline_incident_types','discipline_incidents','discipline_actions','counselling_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted (copies are withdrawn; reservations cancelled). Health check-ups and vaccinations
-- entered by mistake may be removed by the nurse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "library_settings", "library_books", "library_copies", "library_issues", "library_reservations", "library_stock_checks", "library_stock_scans", "student_health_profiles", "infirmary_visits", "discipline_incident_types", "discipline_incidents", "discipline_actions", "counselling_sessions" FROM eduerp_app;
    REVOKE TRUNCATE ON "health_checkups", "vaccinations" FROM eduerp_app;
  END IF;
END $$;
