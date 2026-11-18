-- DropForeignKey
ALTER TABLE "guardians" DROP CONSTRAINT "guardians_user_id_fkey";

-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_user_id_fkey";









-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "vehicle_no" VARCHAR(20) NOT NULL,
    "vehicle_type" VARCHAR(20) NOT NULL,
    "make_model" VARCHAR(100),
    "seating_capacity" SMALLINT NOT NULL,
    "ownership" VARCHAR(10) NOT NULL,
    "owner_name" VARCHAR(150),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "doc_type" VARCHAR(20) NOT NULL,
    "doc_no" VARCHAR(50) NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE NOT NULL,
    "file_id" UUID,
    "alerted_days" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_crew" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" VARCHAR(10) NOT NULL,
    "license_no" VARCHAR(30),
    "license_expiry" DATE,
    "badge_no" VARCHAR(30),
    "alerted_days" SMALLINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "transport_crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "route_no" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "attendant_id" UUID,
    "shift" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "stop_name" VARCHAR(100) NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "pickup_time" VARCHAR(5),
    "drop_time" VARCHAR(5),
    "distance_km" DECIMAL(6,2),
    "fee_amount" DECIMAL(14,2) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_transport" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "route_stop_id" UUID NOT NULL,
    "pickup_drop" VARCHAR(10) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "invoice_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "stop_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "student_transport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_campus_id_status_idx" ON "vehicles"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_id_key" ON "vehicles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_vehicle_no_key" ON "vehicles"("tenant_id", "vehicle_no");

-- CreateIndex
CREATE INDEX "vehicle_documents_tenant_id_vehicle_id_doc_type_idx" ON "vehicle_documents"("tenant_id", "vehicle_id", "doc_type");

-- CreateIndex
CREATE INDEX "vehicle_documents_tenant_id_valid_to_idx" ON "vehicle_documents"("tenant_id", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_documents_tenant_id_id_key" ON "vehicle_documents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_crew_tenant_id_id_key" ON "transport_crew"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_crew_tenant_id_employee_id_key" ON "transport_crew"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_routes_tenant_id_id_key" ON "transport_routes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_routes_tenant_id_campus_id_route_no_key" ON "transport_routes"("tenant_id", "campus_id", "route_no");

-- CreateIndex
CREATE INDEX "route_stops_tenant_id_route_id_status_idx" ON "route_stops"("tenant_id", "route_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_tenant_id_id_key" ON "route_stops"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "student_transport_tenant_id_student_id_academic_year_id_idx" ON "student_transport"("tenant_id", "student_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "student_transport_tenant_id_route_stop_id_status_idx" ON "student_transport"("tenant_id", "route_stop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_transport_tenant_id_id_key" ON "student_transport"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_tenant_id_driver_id_fkey" FOREIGN KEY ("tenant_id", "driver_id") REFERENCES "transport_crew"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_tenant_id_attendant_id_fkey" FOREIGN KEY ("tenant_id", "attendant_id") REFERENCES "transport_crew"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_route_id_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "transport_routes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_tenant_id_route_stop_id_fkey" FOREIGN KEY ("tenant_id", "route_stop_id") REFERENCES "route_stops"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Tenant-scoped links to existing tables (kept out of schema.prisma so those models stay unchanged).
ALTER TABLE "vehicles" ADD CONSTRAINT vehicles_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vehicle_documents" ADD CONSTRAINT vehicle_docs_file_fkey FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT;
ALTER TABLE "transport_crew" ADD CONSTRAINT transport_crew_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "transport_routes" ADD CONSTRAINT transport_routes_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_invoice_fkey FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "vehicles" ADD CONSTRAINT vehicles_type_chk CHECK (vehicle_type IN ('BUS','MINI_BUS','VAN','CAR'));
ALTER TABLE "vehicles" ADD CONSTRAINT vehicles_ownership_chk CHECK (ownership IN ('OWN','HIRED'));
ALTER TABLE "vehicles" ADD CONSTRAINT vehicles_status_chk CHECK (status IN ('ACTIVE','UNDER_REPAIR','INACTIVE'));
ALTER TABLE "vehicles" ADD CONSTRAINT vehicles_seats_chk CHECK (seating_capacity BETWEEN 1 AND 120);
ALTER TABLE "vehicles" ADD CONSTRAINT vehicles_no_chk CHECK (vehicle_no ~ '^[A-Z0-9]{4,15}$');
ALTER TABLE "vehicle_documents" ADD CONSTRAINT vehicle_docs_type_chk CHECK (doc_type IN ('RC','INSURANCE','FITNESS','PERMIT','PUC','TAX'));
ALTER TABLE "vehicle_documents" ADD CONSTRAINT vehicle_docs_dates_chk CHECK (valid_from IS NULL OR valid_from <= valid_to);
ALTER TABLE "vehicle_documents" ADD CONSTRAINT vehicle_docs_alert_chk CHECK (alerted_days IS NULL OR alerted_days IN (30, 15, 7));
ALTER TABLE "transport_crew" ADD CONSTRAINT transport_crew_role_chk CHECK (role IN ('DRIVER','ATTENDANT','CONDUCTOR'));
ALTER TABLE "transport_crew" ADD CONSTRAINT transport_crew_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "transport_crew" ADD CONSTRAINT transport_crew_licence_chk CHECK (role <> 'DRIVER' OR (license_no IS NOT NULL AND license_expiry IS NOT NULL));
ALTER TABLE "transport_crew" ADD CONSTRAINT transport_crew_alert_chk CHECK (alerted_days IS NULL OR alerted_days IN (30, 15, 7));
ALTER TABLE "transport_routes" ADD CONSTRAINT transport_routes_shift_chk CHECK (shift IN ('MORNING','EVENING','BOTH'));
ALTER TABLE "transport_routes" ADD CONSTRAINT transport_routes_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "transport_routes" ADD CONSTRAINT transport_routes_crew_chk CHECK (driver_id IS NULL OR attendant_id IS NULL OR driver_id <> attendant_id);
ALTER TABLE "route_stops" ADD CONSTRAINT route_stops_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "route_stops" ADD CONSTRAINT route_stops_fee_chk CHECK (fee_amount >= 0);
ALTER TABLE "route_stops" ADD CONSTRAINT route_stops_seq_chk CHECK (sequence > 0);
ALTER TABLE "route_stops" ADD CONSTRAINT route_stops_times_chk CHECK (
  (pickup_time IS NULL OR pickup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (drop_time IS NULL OR drop_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
-- Active stops of a route keep distinct positions.
CREATE UNIQUE INDEX route_stops_active_seq_uq ON "route_stops" ("route_id", "sequence") WHERE status = 'ACTIVE';
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_pd_chk CHECK (pickup_drop IN ('BOTH','PICKUP','DROP'));
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_status_chk CHECK (status IN ('ACTIVE','STOPPED'));
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_dates_chk CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE "student_transport" ADD CONSTRAINT student_transport_stopped_chk CHECK ((status = 'STOPPED') = (end_date IS NOT NULL));
-- One active bus stop per student per academic year.
CREATE UNIQUE INDEX student_transport_active_uq ON "student_transport" ("tenant_id", "student_id", "academic_year_id") WHERE status = 'ACTIVE';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles','vehicle_documents','transport_crew','transport_routes','route_stops','student_transport'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "vehicles", "vehicle_documents", "transport_crew", "transport_routes", "route_stops", "student_transport" FROM eduerp_app;
  END IF;
END $$;
