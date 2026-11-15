# B5: Campus Life: Table Structure

Common columns implied. Uses B1: `students, student_guardians (can_pickup), employees, campuses, files, approval_requests, notifications`, and fee charges via **FeeService** (`student_fee_assignments` with source_type HOSTEL / MESS / TRANSPORT / DAMAGE / LIBRARY_FINE).

---

## 1. Hostel

**Requirements:**
- Hostels → rooms → beds.
- Applications and allotment (no over-capacity, gender rule).
- Hostel and deposit fees go to Fees.
- Room inventory checked at check-in/out, with damage charges.
- Caution deposit and refund on vacate.
- Night roll-call with absent alert to parents.
- Outpass (parent approval + warden approval).
- Weekend/holiday home-going register with pickup verification.
- Visitors, maintenance complaints, occupancy dashboard.

```
hostels
  campus_id          UUID FK
  name               VARCHAR(100)
  hostel_type        VARCHAR(10)  BOYS | GIRLS | STAFF
  warden_employee_id UUID FK
  total_capacity     INT                   (calculated)
  status             VARCHAR(20)  ACTIVE | INACTIVE

hostel_rooms
  hostel_id          UUID FK
  block              VARCHAR(30)
  floor              VARCHAR(10)
  room_no            VARCHAR(10)           UQ(hostel_id, room_no)
  room_type          VARCHAR(20)  SINGLE | DOUBLE | TRIPLE | DORMITORY
  capacity           SMALLINT
  is_ac              BOOLEAN
  fee_amount         NUMERIC(14,2)         per year/term
  status             VARCHAR(20)  AVAILABLE | MAINTENANCE | BLOCKED

hostel_beds
  room_id            UUID FK
  bed_no             VARCHAR(5)            UQ(room_id, bed_no)
  status             VARCHAR(20)  VACANT | RESERVED | OCCUPIED | BLOCKED

hostel_applications
  student_id         UUID FK
  academic_year_id   UUID FK
  preferred_hostel_id UUID FK NULL
  preferred_room_type VARCHAR(20)
  special_needs      VARCHAR(300)
  status             VARCHAR(20)  APPLIED | APPROVED | WAITLISTED | REJECTED | ALLOTTED | CANCELLED
  UQ(tenant_id, student_id, academic_year_id) WHERE status NOT IN ('REJECTED','CANCELLED')

hostel_allotments
  application_id     UUID FK NULL
  student_id         UUID FK
  bed_id             UUID FK
  academic_year_id   UUID FK
  check_in_date      DATE
  check_out_date     DATE NULL
  fee_assignment_id  UUID FK → student_fee_assignments
  status             VARCHAR(20)  RESERVED | CHECKED_IN | VACATED | CANCELLED
  UQ(bed_id) WHERE status IN ('RESERVED','CHECKED_IN')                   -- one student per bed
  UQ(tenant_id, student_id) WHERE status IN ('RESERVED','CHECKED_IN')    -- one bed per student

room_inventory_items        -- what each room has
  room_id            UUID FK
  item_name          VARCHAR(100)          Cot | Mattress | Table | Chair | Fan
  quantity           SMALLINT
  unit_cost          NUMERIC(14,2)         for damage charge

allotment_inventory_checks  -- condition at check-in / check-out
  allotment_id       UUID FK
  check_type         VARCHAR(10)  CHECK_IN | CHECK_OUT
  inventory_item_id  UUID FK
  condition          VARCHAR(10)  GOOD | DAMAGED | MISSING
  remarks            VARCHAR(200)
  checked_by         UUID FK
  checked_at         TIMESTAMPTZ

hostel_damage_charges
  allotment_id       UUID FK
  description        VARCHAR(300)
  amount             NUMERIC(14,2)
  approval_request_id UUID FK NULL
  fee_assignment_id  UUID FK NULL          charge posted to fees
  status             VARCHAR(20)  PENDING | APPROVED | CHARGED | WAIVED

hostel_deposits
  allotment_id       UUID FK UQ
  deposit_amount     NUMERIC(14,2)
  payment_id         UUID FK → payments
  deductions         NUMERIC(14,2)         damages / dues
  refund_amount      NUMERIC(14,2)
  refund_id          UUID FK → refunds NULL
  status             VARCHAR(20)  HELD | REFUND_PENDING | REFUNDED | ADJUSTED

hostel_attendance           (partitioned by month) — night roll-call
  hostel_id          UUID FK
  student_id         UUID FK
  attendance_date    DATE
  session            VARCHAR(10)  MORNING | NIGHT
  status             VARCHAR(10)  PRESENT | ABSENT | ON_OUTPASS | ON_LEAVE
  marked_by          UUID FK
  parent_notified    BOOLEAN
  UQ(student_id, attendance_date, session)

hostel_outpasses            -- short outing (same day / few hours)
  student_id         UUID FK
  out_time           TIMESTAMPTZ
  expected_return    TIMESTAMPTZ
  actual_return      TIMESTAMPTZ NULL
  destination        VARCHAR(200)
  reason             VARCHAR(300)
  parent_approval    VARCHAR(10)  PENDING | APPROVED | REJECTED     (parent approves in portal)
  parent_approved_by UUID NULL
  warden_approval    VARCHAR(10)  PENDING | APPROVED | REJECTED
  warden_approved_by UUID NULL
  status             VARCHAR(20)  REQUESTED | APPROVED | REJECTED | OUT | RETURNED | LATE_RETURN | CANCELLED

hostel_home_going           -- weekend / holiday leave register
  student_id         UUID FK
  from_date, to_date DATE
  reason             VARCHAR(300)
  pickup_guardian_id UUID FK NULL          must have can_pickup = true
  pickup_person_name VARCHAR(150) NULL     else needs extra approval
  pickup_person_phone VARCHAR(15)
  pickup_verified_by UUID FK NULL          warden/security at gate
  departed_at        TIMESTAMPTZ NULL
  returned_at        TIMESTAMPTZ NULL
  approval_request_id UUID FK
  status             VARCHAR(20)  REQUESTED | APPROVED | REJECTED | DEPARTED | RETURNED | CANCELLED

hostel_visitors
  hostel_id          UUID FK
  student_id         UUID FK
  visitor_name       VARCHAR(150)
  relation           VARCHAR(30)
  phone              VARCHAR(15)
  is_authorised_guardian BOOLEAN
  in_time, out_time  TIMESTAMPTZ
  recorded_by        UUID FK

hostel_maintenance_requests
  hostel_id          UUID FK
  room_id            UUID FK NULL
  raised_by_user_id  UUID FK
  category           VARCHAR(20)  ELECTRICAL | PLUMBING | FURNITURE | CLEANING | INTERNET | OTHER
  description        VARCHAR(500)
  priority           VARCHAR(10)
  assigned_to        UUID FK NULL
  status             VARCHAR(20)  OPEN | ASSIGNED | IN_PROGRESS | RESOLVED | CLOSED
  resolved_at        TIMESTAMPTZ
```

## 2. Mess

**Requirements:** mess plans (veg/non-veg, full/partial) with fee, weekly menu, student subscription, meal attendance (counts for kitchen planning, and billing if per-meal).

```
mess_plans
  campus_id          UUID FK
  name               VARCHAR(100)          Veg Full Board | Non-Veg | Lunch only
  meals_included     VARCHAR(10)[]         BREAKFAST | LUNCH | SNACKS | DINNER
  billing_type       VARCHAR(10)  FIXED | PER_MEAL
  amount             NUMERIC(14,2)         per month/term (FIXED) or per meal

mess_menus
  campus_id          UUID FK
  day_of_week        SMALLINT
  meal               VARCHAR(10)
  items              VARCHAR(500)
  effective_from     DATE
  UQ(tenant_id, campus_id, day_of_week, meal, effective_from)

mess_subscriptions
  student_id         UUID FK NULL
  employee_id        UUID FK NULL
  mess_plan_id       UUID FK
  from_date, to_date DATE
  fee_assignment_id  UUID FK NULL
  status             VARCHAR(20)  ACTIVE | PAUSED | ENDED

mess_attendance             (partitioned by month)
  subscription_id    UUID FK
  meal_date          DATE
  meal               VARCHAR(10)
  status             VARCHAR(10)  TAKEN | SKIPPED | OPTED_OUT
  UQ(subscription_id, meal_date, meal)
```

## 3. Transport (basic for v1: no GPS)

**Requirements:** buses, documents with expiry alerts (insurance, fitness, permit, PUC), drivers/attendants, routes with stops and timings, stop-wise fee, assign students (capacity check), transport fee to Fees, route-wise student list for drivers.

```
vehicles
  campus_id          UUID FK
  vehicle_no         VARCHAR(20)           UQ(tenant_id, vehicle_no)
  vehicle_type       VARCHAR(20)  BUS | MINI_BUS | VAN | CAR
  make_model         VARCHAR(100)
  seating_capacity   SMALLINT
  ownership          VARCHAR(10)  OWN | HIRED
  status             VARCHAR(20)  ACTIVE | UNDER_REPAIR | INACTIVE

vehicle_documents
  vehicle_id         UUID FK
  doc_type           VARCHAR(20)  RC | INSURANCE | FITNESS | PERMIT | PUC | TAX
  doc_no             VARCHAR(50)
  valid_from, valid_to  DATE
  file_id            UUID NULL
  -- daily job: alert transport manager 30/15/7 days before valid_to

drivers
  employee_id        UUID FK UQ
  role               VARCHAR(10)  DRIVER | ATTENDANT | CONDUCTOR
  license_no         VARCHAR(30) NULL
  license_expiry     DATE NULL
  badge_no           VARCHAR(30)

transport_routes
  campus_id          UUID FK
  route_no           VARCHAR(20)           UQ(tenant_id, campus_id, route_no)
  name               VARCHAR(100)
  vehicle_id         UUID FK
  driver_id          UUID FK → drivers
  attendant_id       UUID FK → drivers NULL
  shift              VARCHAR(10)  MORNING | EVENING | BOTH
  status             VARCHAR(20)  ACTIVE | INACTIVE

route_stops
  route_id           UUID FK
  stop_name          VARCHAR(100)
  sequence           SMALLINT              UQ(route_id, sequence)
  pickup_time, drop_time  TIME
  distance_km        NUMERIC(6,2)
  fee_amount         NUMERIC(14,2)
  latitude, longitude NUMERIC(9,6) NULL    ready for GPS in v2

student_transport
  student_id         UUID FK
  academic_year_id   UUID FK
  route_stop_id      UUID FK
  pickup_drop        VARCHAR(10)  BOTH | PICKUP | DROP
  start_date, end_date  DATE
  fee_assignment_id  UUID FK NULL
  status             VARCHAR(20)  ACTIVE | STOPPED
  UQ(tenant_id, student_id, academic_year_id) WHERE status = 'ACTIVE'
  -- service check: active students on route ≤ vehicle seating_capacity
```

## 4. Library

**Requirements:** catalogue (ISBN, author, publisher, edition, subject), copies with accession no/barcode, issue/return/renew for students and staff, member limits and loan days (settings), reservations, overdue fine (to student fees), lost/damaged, stock verification, overdue reminders.

```
books
  isbn               VARCHAR(20)
  title              VARCHAR(300)
  authors            VARCHAR(300)
  publisher          VARCHAR(150)
  edition            VARCHAR(30)
  publish_year       SMALLINT
  language           VARCHAR(20)
  subject_category   VARCHAR(100)
  call_no            VARCHAR(50)           shelf classification
  INDEX(tenant_id, isbn) ; trigram index on title/authors

book_copies
  book_id            UUID FK
  campus_id          UUID FK               library location
  accession_no       VARCHAR(30)           UQ(tenant_id, accession_no)
  barcode            VARCHAR(50)
  purchase_date      DATE
  price              NUMERIC(14,2)
  rack_location      VARCHAR(50)
  status             VARCHAR(20)  AVAILABLE | ISSUED | RESERVED | LOST | DAMAGED | WITHDRAWN

library_issues
  copy_id            UUID FK
  member_type        VARCHAR(10)  STUDENT | EMPLOYEE
  student_id         UUID FK NULL
  employee_id        UUID FK NULL
  issue_date         DATE
  due_date           DATE
  renew_count        SMALLINT
  return_date        DATE NULL
  fine_amount        NUMERIC(10,2) default 0
  fine_status        VARCHAR(10)  NONE | PENDING | CHARGED | PAID | WAIVED
  issued_by, returned_to  UUID FK
  status             VARCHAR(20)  ISSUED | RETURNED | LOST
  UQ(copy_id) WHERE status = 'ISSUED'      -- a copy can't be issued twice

library_reservations
  book_id            UUID FK
  member_type        VARCHAR(10)
  student_id, employee_id  UUID NULL
  reserved_at        TIMESTAMPTZ
  expires_at         TIMESTAMPTZ NULL
  status             VARCHAR(20)  WAITING | READY | COLLECTED | CANCELLED | EXPIRED

library_stock_checks
  campus_id          UUID FK
  check_date         DATE
  copy_id            UUID FK
  found              BOOLEAN
  remarks            VARCHAR(200)
  checked_by         UUID FK
```

## 5. Health & infirmary (restricted: nurse, principal, warden for hostellers)

```
student_health_profiles
  student_id         UUID FK UQ
  height_cm, weight_kg  NUMERIC(5,1)
  allergies          VARCHAR(500)
  chronic_conditions VARCHAR(500)
  medications        VARCHAR(500)
  disability         VARCHAR(200)
  family_doctor_name, family_doctor_phone
  updated_on         DATE

infirmary_visits
  campus_id          UUID FK
  patient_type       VARCHAR(10)  STUDENT | EMPLOYEE
  student_id, employee_id  UUID NULL
  visit_time         TIMESTAMPTZ
  complaint          VARCHAR(300)
  temperature        NUMERIC(4,1) NULL
  treatment_given    VARCHAR(500)
  medicine_given     VARCHAR(300)
  action             VARCHAR(20)  RETURNED_TO_CLASS | SENT_HOME | HOSPITAL_REFERRED | REST
  parent_informed    BOOLEAN
  attended_by        UUID FK

health_checkups             -- periodic checkup camps
  student_id         UUID FK
  checkup_date       DATE
  checkup_type       VARCHAR(20)  GENERAL | DENTAL | EYE | BMI
  findings           TEXT
  recommendation     VARCHAR(500)
  doctor_name        VARCHAR(150)

vaccinations
  student_id         UUID FK
  vaccine_name       VARCHAR(100)
  dose_no            SMALLINT
  vaccination_date   DATE
  next_due_date      DATE NULL
```

## 6. Discipline & counselling (restricted: counsellor, principal, class teacher read-only)

```
discipline_incident_types
  name               VARCHAR(100)          Late coming | Uniform | Misconduct | Ragging | Bullying …
  severity           VARCHAR(10)  LOW | MEDIUM | HIGH | CRITICAL
  notify_parent      BOOLEAN

discipline_incidents
  campus_id          UUID FK
  student_id         UUID FK
  incident_type_id   UUID FK
  incident_date      TIMESTAMPTZ
  location           VARCHAR(100)
  description        TEXT
  reported_by        UUID FK
  witnesses          VARCHAR(300)
  status             VARCHAR(20)  REPORTED | UNDER_REVIEW | ACTION_TAKEN | CLOSED
  parent_notified    BOOLEAN

discipline_actions
  incident_id        UUID FK
  action_type        VARCHAR(20)  WARNING | PARENT_MEETING | SUSPENSION | FINE | COUNSELLING | OTHER
  description        VARCHAR(500)
  from_date, to_date DATE NULL             suspension period
  fine_amount        NUMERIC(14,2) NULL    → fees
  approved_by        UUID FK

counselling_sessions        -- highly restricted (counsellor only)
  student_id         UUID FK
  counsellor_employee_id UUID FK
  session_date       TIMESTAMPTZ
  referral_source    VARCHAR(20)  SELF | TEACHER | PARENT | DISCIPLINE
  incident_id        UUID FK NULL
  notes              TEXT                  encrypted
  follow_up_date     DATE NULL
  is_confidential    BOOLEAN default true
```

---

**B5 table count: 37** (hostel 14 · mess 4 · transport 6 · library 5 · health 4 · discipline 4).
