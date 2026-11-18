-- DropForeignKey
ALTER TABLE "student_transport" DROP CONSTRAINT "student_transport_invoice_fkey";

-- DropForeignKey
ALTER TABLE "student_transport" DROP CONSTRAINT "student_transport_student_fkey";

-- DropForeignKey
ALTER TABLE "student_transport" DROP CONSTRAINT "student_transport_year_fkey";

-- DropForeignKey
ALTER TABLE "transport_crew" DROP CONSTRAINT "transport_crew_employee_fkey";

-- DropForeignKey
ALTER TABLE "transport_routes" DROP CONSTRAINT "transport_routes_campus_fkey";

-- DropForeignKey
ALTER TABLE "vehicle_documents" DROP CONSTRAINT "vehicle_docs_file_fkey";

-- DropForeignKey
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_campus_fkey";









-- CreateTable
CREATE TABLE "hostels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "hostel_type" VARCHAR(10) NOT NULL,
    "warden_employee_id" UUID,
    "deposit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "block" VARCHAR(30),
    "floor" VARCHAR(10),
    "room_no" VARCHAR(10) NOT NULL,
    "room_type" VARCHAR(20) NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "is_ac" BOOLEAN NOT NULL DEFAULT false,
    "fee_amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_beds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "bed_no" VARCHAR(5) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'VACANT',
    "blocked_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_inventory_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "item_name" VARCHAR(100) NOT NULL,
    "quantity" SMALLINT NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "room_inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_allotments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "check_in_date" DATE NOT NULL,
    "check_out_date" DATE,
    "room_invoice_id" UUID,
    "deposit_invoice_id" UUID,
    "moved_from_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    "end_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "hostel_allotments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allotment_item_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "allotment_id" UUID NOT NULL,
    "check_type" VARCHAR(10) NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "condition" VARCHAR(10) NOT NULL,
    "remarks" VARCHAR(200),
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allotment_item_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_damage_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "allotment_id" UUID NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "approval_request_id" UUID,
    "invoice_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "hostel_damage_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_roll_calls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "remarks" VARCHAR(200),
    "marked_by" UUID NOT NULL,
    "parent_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_roll_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_outpasses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "out_time" TIMESTAMPTZ(6) NOT NULL,
    "expected_return" TIMESTAMPTZ(6) NOT NULL,
    "actual_out" TIMESTAMPTZ(6),
    "actual_return" TIMESTAMPTZ(6),
    "destination" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "parent_approval" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "parent_approved_by" UUID,
    "warden_approval" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "warden_approved_by" UUID,
    "remarks" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_outpasses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_home_going" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "pickup_guardian_id" UUID,
    "pickup_person_name" VARCHAR(150),
    "pickup_person_phone" VARCHAR(15),
    "decided_by" UUID,
    "pickup_verified_by" UUID,
    "departed_at" TIMESTAMPTZ(6),
    "returned_at" TIMESTAMPTZ(6),
    "remarks" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_home_going_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_visitors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "visitor_name" VARCHAR(150) NOT NULL,
    "relation" VARCHAR(30) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "is_authorised_guardian" BOOLEAN NOT NULL DEFAULT false,
    "in_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "out_time" TIMESTAMPTZ(6),
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "hostel_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_maintenance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "room_id" UUID,
    "raised_by" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "assigned_to_employee_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "remarks" VARCHAR(300),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hostel_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "meals_included" VARCHAR(10)[],
    "billing_type" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "mess_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_menus" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "meal" VARCHAR(10) NOT NULL,
    "items" VARCHAR(500) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "mess_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID,
    "employee_id" UUID,
    "mess_plan_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "invoice_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "mess_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hostels_tenant_id_id_key" ON "hostels"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hostels_tenant_id_campus_id_name_key" ON "hostels"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_rooms_tenant_id_id_key" ON "hostel_rooms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_rooms_tenant_id_hostel_id_room_no_key" ON "hostel_rooms"("tenant_id", "hostel_id", "room_no");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_beds_tenant_id_id_key" ON "hostel_beds"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_beds_tenant_id_room_id_bed_no_key" ON "hostel_beds"("tenant_id", "room_id", "bed_no");

-- CreateIndex
CREATE UNIQUE INDEX "room_inventory_items_tenant_id_id_key" ON "room_inventory_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "hostel_allotments_tenant_id_student_id_idx" ON "hostel_allotments"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_allotments_tenant_id_id_key" ON "hostel_allotments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "allotment_item_checks_tenant_id_allotment_id_check_type_inv_key" ON "allotment_item_checks"("tenant_id", "allotment_id", "check_type", "inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_damage_charges_tenant_id_id_key" ON "hostel_damage_charges"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "hostel_roll_calls_tenant_id_hostel_id_attendance_date_idx" ON "hostel_roll_calls"("tenant_id", "hostel_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_roll_calls_tenant_id_student_id_attendance_date_key" ON "hostel_roll_calls"("tenant_id", "student_id", "attendance_date");

-- CreateIndex
CREATE INDEX "hostel_outpasses_tenant_id_hostel_id_status_idx" ON "hostel_outpasses"("tenant_id", "hostel_id", "status");

-- CreateIndex
CREATE INDEX "hostel_outpasses_tenant_id_student_id_idx" ON "hostel_outpasses"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_outpasses_tenant_id_id_key" ON "hostel_outpasses"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "hostel_home_going_tenant_id_hostel_id_status_idx" ON "hostel_home_going"("tenant_id", "hostel_id", "status");

-- CreateIndex
CREATE INDEX "hostel_home_going_tenant_id_student_id_idx" ON "hostel_home_going"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_home_going_tenant_id_id_key" ON "hostel_home_going"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "hostel_visitors_tenant_id_hostel_id_in_time_idx" ON "hostel_visitors"("tenant_id", "hostel_id", "in_time");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_visitors_tenant_id_id_key" ON "hostel_visitors"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "hostel_maintenance_tenant_id_hostel_id_status_idx" ON "hostel_maintenance"("tenant_id", "hostel_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_maintenance_tenant_id_id_key" ON "hostel_maintenance"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mess_plans_tenant_id_id_key" ON "mess_plans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mess_plans_tenant_id_campus_id_name_key" ON "mess_plans"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "mess_menus_tenant_id_campus_id_day_of_week_meal_effective_f_key" ON "mess_menus"("tenant_id", "campus_id", "day_of_week", "meal", "effective_from");

-- CreateIndex
CREATE INDEX "mess_subscriptions_tenant_id_student_id_idx" ON "mess_subscriptions"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "mess_subscriptions_tenant_id_employee_id_idx" ON "mess_subscriptions"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "mess_subscriptions_tenant_id_id_key" ON "mess_subscriptions"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_tenant_id_hostel_id_fkey" FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "hostel_rooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_inventory_items" ADD CONSTRAINT "room_inventory_items_tenant_id_room_id_fkey" FOREIGN KEY ("tenant_id", "room_id") REFERENCES "hostel_rooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_allotments" ADD CONSTRAINT "hostel_allotments_tenant_id_bed_id_fkey" FOREIGN KEY ("tenant_id", "bed_id") REFERENCES "hostel_beds"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allotment_item_checks" ADD CONSTRAINT "allotment_item_checks_tenant_id_allotment_id_fkey" FOREIGN KEY ("tenant_id", "allotment_id") REFERENCES "hostel_allotments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allotment_item_checks" ADD CONSTRAINT "allotment_item_checks_tenant_id_inventory_item_id_fkey" FOREIGN KEY ("tenant_id", "inventory_item_id") REFERENCES "room_inventory_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_damage_charges" ADD CONSTRAINT "hostel_damage_charges_tenant_id_allotment_id_fkey" FOREIGN KEY ("tenant_id", "allotment_id") REFERENCES "hostel_allotments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT "mess_subscriptions_tenant_id_mess_plan_id_fkey" FOREIGN KEY ("tenant_id", "mess_plan_id") REFERENCES "mess_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- Tenant-scoped links to existing tables (kept out of schema.prisma so those models stay unchanged).
ALTER TABLE "hostels" ADD CONSTRAINT hostels_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostels" ADD CONSTRAINT hostels_warden_fkey FOREIGN KEY ("tenant_id", "warden_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_year_fkey FOREIGN KEY ("tenant_id", "academic_year_id") REFERENCES "academic_years"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_room_inv_fkey FOREIGN KEY ("tenant_id", "room_invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_dep_inv_fkey FOREIGN KEY ("tenant_id", "deposit_invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_moved_fkey FOREIGN KEY ("tenant_id", "moved_from_id") REFERENCES "hostel_allotments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_damage_charges" ADD CONSTRAINT hostel_damage_inv_fkey FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_roll_calls" ADD CONSTRAINT hostel_roll_hostel_fkey FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_roll_calls" ADD CONSTRAINT hostel_roll_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_outpasses" ADD CONSTRAINT hostel_outpass_hostel_fkey FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_outpasses" ADD CONSTRAINT hostel_outpass_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_home_going" ADD CONSTRAINT hostel_home_hostel_fkey FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_home_going" ADD CONSTRAINT hostel_home_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_home_going" ADD CONSTRAINT hostel_home_guardian_fkey FOREIGN KEY ("tenant_id", "pickup_guardian_id") REFERENCES "guardians"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_visitors" ADD CONSTRAINT hostel_visitor_hostel_fkey FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_visitors" ADD CONSTRAINT hostel_visitor_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_maintenance" ADD CONSTRAINT hostel_maint_hostel_fkey FOREIGN KEY ("tenant_id", "hostel_id") REFERENCES "hostels"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_maintenance" ADD CONSTRAINT hostel_maint_room_fkey FOREIGN KEY ("tenant_id", "room_id") REFERENCES "hostel_rooms"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "hostel_maintenance" ADD CONSTRAINT hostel_maint_staff_fkey FOREIGN KEY ("tenant_id", "assigned_to_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mess_plans" ADD CONSTRAINT mess_plans_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mess_menus" ADD CONSTRAINT mess_menus_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT mess_subs_student_fkey FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT mess_subs_employee_fkey FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT mess_subs_invoice_fkey FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "fee_invoices"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "hostels" ADD CONSTRAINT hostels_type_chk CHECK (hostel_type IN ('BOYS','GIRLS','STAFF'));
ALTER TABLE "hostels" ADD CONSTRAINT hostels_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "hostels" ADD CONSTRAINT hostels_deposit_chk CHECK (deposit_amount >= 0);
ALTER TABLE "hostel_rooms" ADD CONSTRAINT hostel_rooms_type_chk CHECK (room_type IN ('SINGLE','DOUBLE','TRIPLE','DORMITORY'));
ALTER TABLE "hostel_rooms" ADD CONSTRAINT hostel_rooms_status_chk CHECK (status IN ('AVAILABLE','MAINTENANCE','BLOCKED'));
ALTER TABLE "hostel_rooms" ADD CONSTRAINT hostel_rooms_capacity_chk CHECK (capacity BETWEEN 1 AND 40);
ALTER TABLE "hostel_rooms" ADD CONSTRAINT hostel_rooms_fee_chk CHECK (fee_amount >= 0);
-- RETIRED = a bed taken out when the room's capacity was reduced (beds are never deleted).
ALTER TABLE "hostel_beds" ADD CONSTRAINT hostel_beds_status_chk CHECK (status IN ('VACANT','RESERVED','OCCUPIED','BLOCKED','RETIRED'));
ALTER TABLE "room_inventory_items" ADD CONSTRAINT room_inv_qty_chk CHECK (quantity > 0 AND unit_cost >= 0);
ALTER TABLE "room_inventory_items" ADD CONSTRAINT room_inv_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_status_chk CHECK (status IN ('RESERVED','CHECKED_IN','VACATED','CANCELLED'));
ALTER TABLE "hostel_allotments" ADD CONSTRAINT hostel_allot_dates_chk CHECK (check_out_date IS NULL OR check_out_date >= check_in_date);
-- One student per bed, one bed per student (while reserved or checked in).
CREATE UNIQUE INDEX hostel_allot_bed_uq ON "hostel_allotments" ("bed_id") WHERE status IN ('RESERVED','CHECKED_IN');
CREATE UNIQUE INDEX hostel_allot_student_uq ON "hostel_allotments" ("tenant_id", "student_id") WHERE status IN ('RESERVED','CHECKED_IN');
ALTER TABLE "allotment_item_checks" ADD CONSTRAINT item_checks_type_chk CHECK (check_type IN ('CHECK_IN','CHECK_OUT'));
ALTER TABLE "allotment_item_checks" ADD CONSTRAINT item_checks_cond_chk CHECK (condition IN ('GOOD','DAMAGED','MISSING'));
ALTER TABLE "hostel_damage_charges" ADD CONSTRAINT hostel_damage_status_chk CHECK (status IN ('PENDING','CHARGED','WAIVED'));
ALTER TABLE "hostel_damage_charges" ADD CONSTRAINT hostel_damage_amount_chk CHECK (amount > 0);
ALTER TABLE "hostel_damage_charges" ADD CONSTRAINT hostel_damage_charged_chk CHECK ((status = 'CHARGED') = (invoice_id IS NOT NULL));
ALTER TABLE "hostel_roll_calls" ADD CONSTRAINT hostel_roll_status_chk CHECK (status IN ('PRESENT','ABSENT','ON_OUTPASS','ON_LEAVE'));
ALTER TABLE "hostel_outpasses" ADD CONSTRAINT hostel_outpass_status_chk CHECK (status IN ('REQUESTED','APPROVED','REJECTED','OUT','RETURNED','LATE_RETURN','CANCELLED'));
ALTER TABLE "hostel_outpasses" ADD CONSTRAINT hostel_outpass_appr_chk CHECK (parent_approval IN ('PENDING','APPROVED','REJECTED') AND warden_approval IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE "hostel_outpasses" ADD CONSTRAINT hostel_outpass_times_chk CHECK (expected_return > out_time);
-- The student can be out only on an outpass both the parent and the warden approved.
ALTER TABLE "hostel_outpasses" ADD CONSTRAINT hostel_outpass_both_chk CHECK (status NOT IN ('APPROVED','OUT','RETURNED','LATE_RETURN') OR (parent_approval = 'APPROVED' AND warden_approval = 'APPROVED'));
ALTER TABLE "hostel_home_going" ADD CONSTRAINT hostel_home_status_chk CHECK (status IN ('REQUESTED','APPROVED','REJECTED','DEPARTED','RETURNED','CANCELLED'));
ALTER TABLE "hostel_home_going" ADD CONSTRAINT hostel_home_dates_chk CHECK (to_date >= from_date);
ALTER TABLE "hostel_home_going" ADD CONSTRAINT hostel_home_pickup_chk CHECK (pickup_guardian_id IS NOT NULL OR (pickup_person_name IS NOT NULL AND pickup_person_phone IS NOT NULL));
ALTER TABLE "hostel_maintenance" ADD CONSTRAINT hostel_maint_cat_chk CHECK (category IN ('ELECTRICAL','PLUMBING','FURNITURE','CLEANING','INTERNET','OTHER'));
ALTER TABLE "hostel_maintenance" ADD CONSTRAINT hostel_maint_status_chk CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'));
ALTER TABLE "hostel_maintenance" ADD CONSTRAINT hostel_maint_prio_chk CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT'));
ALTER TABLE "mess_plans" ADD CONSTRAINT mess_plans_billing_chk CHECK (billing_type IN ('FIXED','PER_MEAL'));
ALTER TABLE "mess_plans" ADD CONSTRAINT mess_plans_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "mess_plans" ADD CONSTRAINT mess_plans_meals_chk CHECK (cardinality(meals_included) BETWEEN 1 AND 4 AND meals_included <@ ARRAY['BREAKFAST','LUNCH','SNACKS','DINNER']::varchar[]);
ALTER TABLE "mess_plans" ADD CONSTRAINT mess_plans_amount_chk CHECK (amount >= 0);
ALTER TABLE "mess_menus" ADD CONSTRAINT mess_menus_day_chk CHECK (day_of_week BETWEEN 1 AND 7 AND meal IN ('BREAKFAST','LUNCH','SNACKS','DINNER'));
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT mess_subs_who_chk CHECK ((student_id IS NULL) <> (employee_id IS NULL));
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT mess_subs_status_chk CHECK (status IN ('ACTIVE','PAUSED','ENDED'));
ALTER TABLE "mess_subscriptions" ADD CONSTRAINT mess_subs_dates_chk CHECK (to_date IS NULL OR to_date >= from_date);
-- One running plan per person.
CREATE UNIQUE INDEX mess_subs_student_uq ON "mess_subscriptions" ("tenant_id", "student_id") WHERE status = 'ACTIVE' AND student_id IS NOT NULL;
CREATE UNIQUE INDEX mess_subs_employee_uq ON "mess_subscriptions" ("tenant_id", "employee_id") WHERE status = 'ACTIVE' AND employee_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hostels','hostel_rooms','hostel_beds','room_inventory_items','hostel_allotments','allotment_item_checks','hostel_damage_charges','hostel_roll_calls','hostel_outpasses','hostel_home_going','hostel_visitors','hostel_maintenance','mess_plans','mess_menus','mess_subscriptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "hostels", "hostel_rooms", "hostel_beds", "room_inventory_items", "hostel_allotments", "allotment_item_checks", "hostel_damage_charges",
      "hostel_roll_calls", "hostel_outpasses", "hostel_home_going", "hostel_visitors", "hostel_maintenance", "mess_plans", "mess_menus", "mess_subscriptions" FROM eduerp_app;
  END IF;
END $$;
