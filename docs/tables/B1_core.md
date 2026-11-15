# B1: Core: Table Structure

Common columns (`id, tenant_id, created_at, updated_at, created_by, updated_by`) are implied. See [../BASIC_PHASE_DESIGN.md](../BASIC_PHASE_DESIGN.md) §A4.
Notation: `column  TYPE  rules/notes`. **UQ** = unique, **FK** = foreign key, **NN** = not null.

---

## 1. SaaS platform & subscriptions (platform tables: no tenant_id unless shown)

**Requirements:** super admin creates institutions, assigns a plan, enables modules, tracks subscription and renewal, suspends or reactivates.

```
tenants
  name               VARCHAR(200) NN
  name_local         VARCHAR(200)          Kannada name (print)
  slug               VARCHAR(50)  UQ       subdomain e.g. abc.eduerp.in
  institution_type   VARCHAR(20)           SCHOOL | PU_COLLEGE | DEGREE_COLLEGE | UNIVERSITY | GROUP
  logo_file_id       UUID
  email, phone, website
  address, city, district, state, pincode
  timezone           VARCHAR(50)  default 'Asia/Kolkata'
  default_language   VARCHAR(5)   en | kn
  status             VARCHAR(20)  TRIAL | ACTIVE | GRACE | SUSPENDED | CLOSED

plans
  name               VARCHAR(100)          Basic / Standard / Premium
  code               VARCHAR(30)  UQ
  price_per_student  NUMERIC(10,2)
  billing_cycle      VARCHAR(10)  MONTHLY | YEARLY
  max_students       INT NULL
  is_active          BOOLEAN

plan_modules
  plan_id            UUID FK → plans
  module_code        VARCHAR(40)           FEES | HOSTEL | TRANSPORT | ...
  UQ(plan_id, module_code)

tenant_subscriptions        (has tenant_id)
  plan_id            UUID FK
  start_date, end_date  DATE
  student_count      INT
  amount             NUMERIC(14,2)
  status             VARCHAR(20)  TRIAL | ACTIVE | EXPIRED | CANCELLED

tenant_modules              (has tenant_id) — final on/off per institution
  module_code        VARCHAR(40)
  is_enabled         BOOLEAN
  UQ(tenant_id, module_code)

platform_invoices           (has tenant_id) — our bill to the institution
  invoice_no         VARCHAR(30) UQ
  subscription_id    UUID FK
  amount, gst_amount, total  NUMERIC(14,2)
  due_date           DATE
  status             VARCHAR(20)  UNPAID | PAID | OVERDUE
```

## 2. Institution setup

**Requirements:** campuses, departments, academic years, holidays, settings with campus override.

```
campuses
  code               VARCHAR(20) NN        UQ(tenant_id, code)
  name               VARCHAR(200) NN
  name_local         VARCHAR(200)
  campus_type        VARCHAR(20)  SCHOOL | PU | DEGREE | PG | OTHER
  affiliation_no     VARCHAR(50)           board/university affiliation
  udise_code         VARCHAR(20)           school UDISE+
  address, city, district, state, pincode, phone, email
  principal_employee_id  UUID FK → employees NULL
  status             VARCHAR(20)  ACTIVE | INACTIVE

departments
  campus_id          UUID FK NULL          NULL = institution-wide (e.g. Accounts)
  name               VARCHAR(100) NN
  code               VARCHAR(20)           UQ(tenant_id, campus_id, code)
  dept_type          VARCHAR(20)  ACADEMIC | ADMIN | SUPPORT
  head_employee_id   UUID FK → employees NULL

academic_years
  name               VARCHAR(20)           2026-27   UQ(tenant_id, name)
  start_date, end_date  DATE               CHECK(end_date > start_date)
  is_current         BOOLEAN               only one current per tenant
  status             VARCHAR(20)  PLANNING | ACTIVE | CLOSED

holidays
  campus_id          UUID FK NULL          NULL = all campuses
  holiday_date       DATE
  name               VARCHAR(100)
  holiday_type       VARCHAR(20)  PUBLIC | INSTITUTION | EXAM_BREAK
  UQ(tenant_id, campus_id, holiday_date)

settings
  campus_id          UUID NULL             NULL = institution default
  setting_key        VARCHAR(80)           e.g. attendance.late_after_minutes
  setting_value      JSONB
  UQ(tenant_id, campus_id, setting_key)
```

## 3. Users, roles & login

**Requirements:** staff log in with email/phone + password (+ OTP for sensitive actions). Parents and students log in with mobile OTP. One user can belong to several institutions. Role per campus.

```
users                       (global, no tenant_id)
  full_name          VARCHAR(150)
  email              VARCHAR(150) UQ NULL
  phone              VARCHAR(15)  UQ NULL
  password_hash      VARCHAR(255) NULL     argon2
  preferred_language VARCHAR(5)  en | kn
  platform_role      VARCHAR(20) NULL     SUPER_ADMIN | SUPPORT (SaaS operator staff; CD-12)
  mfa_enabled        BOOLEAN
  status             VARCHAR(20)  ACTIVE | LOCKED | DISABLED
  failed_login_count INT
  locked_until       TIMESTAMPTZ NULL     lockout after repeated failures
  last_login_at      TIMESTAMPTZ
  CHECK(email IS NOT NULL OR phone IS NOT NULL)

user_tenants
  user_id            UUID FK
  user_type          VARCHAR(20)  STAFF | PARENT | STUDENT
  status             VARCHAR(20)  INVITED | ACTIVE | REMOVED
  UQ(tenant_id, user_id)

roles
  name               VARCHAR(100)
  code               VARCHAR(50)           UQ(tenant_id, code)
  is_system          BOOLEAN               default roles can't be deleted

permissions                 (global master)
  code               VARCHAR(100) UQ       student.create, fees.collect …
  module_code        VARCHAR(40)
  description        VARCHAR(200)

role_permissions
  role_id, permission_id   PK(role_id, permission_id)

user_roles
  user_id            UUID FK
  role_id            UUID FK
  campus_id          UUID FK NULL          NULL = all campuses
  department_id      UUID FK NULL          optional narrower scope
  UQ(tenant_id, user_id, role_id, campus_id, department_id)

otp_codes                   (global)
  phone_or_email     VARCHAR(150)
  purpose            VARCHAR(20)  LOGIN | RESET | VERIFY
  code_hash          VARCHAR(255)
  expires_at         TIMESTAMPTZ
  attempts           SMALLINT
  used_at            TIMESTAMPTZ NULL

refresh_tokens              (global)
  user_id            UUID FK
  tenant_id          UUID NULL            NULL until an institution is chosen
  family_id          UUID                 one login session; reuse of a rotated token revokes the family
  token_hash         VARCHAR(255) UQ
  device_info        VARCHAR(200)
  expires_at         TIMESTAMPTZ
  revoked_at         TIMESTAMPTZ NULL
  replaced_by        UUID NULL            rotation chain

login_history
  user_id            UUID
  identifier         VARCHAR(150)         email/phone typed (also for unknown users)
  login_at           TIMESTAMPTZ
  ip_address         VARCHAR(45)
  user_agent         VARCHAR(300)
  success            BOOLEAN
  failure_reason     VARCHAR(100)
```

## 4. Shared services (used by all modules)

```
number_sequences
  campus_id          UUID NULL
  doc_type           VARCHAR(30)  ADMISSION | APPLICATION | RECEIPT | INVOICE | EMPLOYEE | TC | JOURNAL …
  prefix             VARCHAR(30)           e.g. RCPT/26-27/
  next_number        INT default 1
  padding            SMALLINT default 5
  year_label         VARCHAR(10)
  UQ(tenant_id, campus_id, doc_type, year_label)        locked FOR UPDATE when used

files
  entity_type        VARCHAR(40)           STUDENT | EMPLOYEE | APPLICATION | FEED_POST …
  entity_id          UUID
  doc_type           VARCHAR(50)           PHOTO | BIRTH_CERT | AADHAAR_MASKED | TC …
  file_name          VARCHAR(255)
  storage_key        VARCHAR(500)
  mime_type          VARCHAR(100)
  size_bytes         BIGINT
  is_verified        BOOLEAN
  verified_by        UUID NULL
  INDEX(tenant_id, entity_type, entity_id)

audit_logs                  (partitioned by month)
  user_id            UUID
  campus_id          UUID NULL
  action             VARCHAR(40)           CREATE | UPDATE | APPROVE | CANCEL | LOGIN | EXPORT …
  entity_type        VARCHAR(50)
  entity_id          UUID
  old_values         JSONB
  new_values         JSONB
  reason             VARCHAR(300)
  ip_address         VARCHAR(45)
  request_id         VARCHAR(64)          correlates with API logs (audit_logs)
  created_at         TIMESTAMPTZ
  -- append only: no update/delete

approval_rules              -- who approves what
  campus_id          UUID NULL
  entity_type        VARCHAR(40)           CONCESSION | REFUND | LEAVE | OUTPASS | PURCHASE_ORDER …
  min_amount         NUMERIC(14,2) NULL    rule applies above this amount
  level_no           SMALLINT              1, 2, 3 (multi-level)
  approver_role_id   UUID FK → roles
  UQ(tenant_id, campus_id, entity_type, level_no, min_amount)

approval_requests
  entity_type        VARCHAR(40)
  entity_id          UUID
  requested_by       UUID FK → users
  current_level      SMALLINT
  status             VARCHAR(20)  PENDING | APPROVED | REJECTED | CANCELLED
  completed_at       TIMESTAMPTZ

approval_actions
  approval_request_id UUID FK
  level_no           SMALLINT
  action_by          UUID FK → users       CHECK ≠ requested_by (rule in service)
  action             VARCHAR(10)  APPROVE | REJECT | RETURN
  remarks            VARCHAR(500)
  action_at          TIMESTAMPTZ
```

## 5. Academic structure (needed by students; teaching features are in B2)

**Requirements:** one structure for all types.

| Type | programs | program_levels | sections |
|---|---|---|---|
| School | "CBSE School" / "State Board School" | Class 1 … 10 | A, B, C |
| PU | "PU Science PCMB", "PU Commerce" (stream) | I PUC, II PUC | A, B |
| Degree/PG (CBCS) | "B.Com", "B.Sc PCM", "MBA" | Semester 1 … 8 | Batch 1, Div A |

```
education_boards
  name               VARCHAR(100)          CBSE | Karnataka State Board | Karnataka PU Board | VTU …
  board_type         VARCHAR(20)  SCHOOL_BOARD | PU_BOARD | UNIVERSITY
  grading_system     VARCHAR(20)  MARKS | GRADES | CBCS

programs
  campus_id          UUID FK
  board_id           UUID FK → education_boards
  name               VARCHAR(150)
  code               VARCHAR(20)           UQ(tenant_id, campus_id, code)
  program_type       VARCHAR(20)  SCHOOL | PU | UG | PG | DIPLOMA
  stream             VARCHAR(50) NULL      SCIENCE | COMMERCE | ARTS (PU)
  duration_levels    SMALLINT              10 classes / 2 years / 6 semesters
  level_label        VARCHAR(20)           "Class" | "Year" | "Semester"
  department_id      UUID FK NULL

program_levels
  program_id         UUID FK
  name               VARCHAR(50)           Class 5 | II PUC | Semester 3
  sequence           SMALLINT              promotion order   UQ(program_id, sequence)
  is_final           BOOLEAN               last level → passed out

sections
  campus_id          UUID FK
  academic_year_id   UUID FK
  program_level_id   UUID FK
  name               VARCHAR(20)
  capacity           INT
  class_teacher_id   UUID FK → employees NULL
  room               VARCHAR(30)
  UQ(tenant_id, academic_year_id, program_level_id, name)

subjects
  code               VARCHAR(20)           UQ(tenant_id, code)
  name               VARCHAR(100)
  name_local         VARCHAR(100)
  subject_type       VARCHAR(20)  THEORY | PRACTICAL | THEORY_PRACTICAL | ACTIVITY
  credits            NUMERIC(4,1) NULL     CBCS
  is_language        BOOLEAN

level_subjects              -- syllabus: which subjects in which class/semester
  program_level_id   UUID FK
  subject_id         UUID FK
  subject_group      VARCHAR(20)  CORE | ELECTIVE | LANGUAGE_1 | LANGUAGE_2 | OPEN_ELECTIVE
  is_optional        BOOLEAN
  UQ(program_level_id, subject_id)

section_subject_teachers
  section_id         UUID FK
  subject_id         UUID FK
  employee_id        UUID FK
  UQ(section_id, subject_id, employee_id)
```

## 6. Staff (basic; full HR in B4)

```
employees
  campus_id          UUID FK
  user_id            UUID FK → users NULL
  employee_code      VARCHAR(20)           UQ(tenant_id, employee_code)
  first_name, last_name  VARCHAR(80)
  name_local         VARCHAR(150)
  gender             VARCHAR(10)
  dob                DATE
  phone, email       VARCHAR
  department_id      UUID FK
  designation_id     UUID FK → designations NULL (B4)
  employee_type      VARCHAR(20)  TEACHING | NON_TEACHING | CONTRACT | VISITING
  joining_date       DATE
  photo_file_id      UUID
  status             VARCHAR(20)  ACTIVE | ON_LEAVE | RESIGNED | TERMINATED
```

## 7. Admissions

**Requirements:** enquiry → follow-ups → online/offline application → documents → approve/reject/waitlist → enrol. Duplicate check. Application fee via Razorpay.

```
enquiries
  campus_id, academic_year_id   UUID FK
  enquiry_no         VARCHAR(30)
  student_name       VARCHAR(150)
  dob                DATE NULL
  parent_name        VARCHAR(150)
  phone              VARCHAR(15) NN
  email              VARCHAR(150)
  program_level_id   UUID FK
  source             VARCHAR(20)  WALK_IN | WEBSITE | PHONE | REFERRAL | CAMPAIGN | SOCIAL
  assigned_to        UUID FK → users
  status             VARCHAR(20)  NEW | FOLLOW_UP | INTERESTED | CONVERTED | LOST
  next_follow_up     DATE
  INDEX(tenant_id, phone)

enquiry_followups
  enquiry_id         UUID FK
  followup_date      TIMESTAMPTZ
  mode               VARCHAR(10)  CALL | VISIT | SMS | WHATSAPP
  remarks            VARCHAR(500)
  next_follow_up     DATE

admission_applications
  campus_id, academic_year_id   UUID FK
  application_no     VARCHAR(30)           UQ(tenant_id, application_no)
  enquiry_id         UUID FK NULL
  program_level_id   UUID FK
  first_name, last_name  VARCHAR(80)
  name_local         VARCHAR(150)
  dob                DATE
  gender             VARCHAR(10)
  category           VARCHAR(20)  GENERAL | SC | ST | OBC | CAT_1 | 2A | 2B | 3A | 3B   (configurable list)
  religion, nationality, mother_tongue  VARCHAR(30)
  father_name, mother_name, guardian_name  VARCHAR(150)
  parent_phone       VARCHAR(15) NN
  parent_email       VARCHAR(150)
  address            TEXT
  previous_institution VARCHAR(200)
  previous_marks_percent NUMERIC(5,2)
  application_fee    NUMERIC(14,2)
  fee_payment_id     UUID FK → payments NULL
  status             VARCHAR(20)  DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED | WAITLISTED | ENROLLED | CANCELLED
  reviewed_by        UUID FK
  reviewed_at        TIMESTAMPTZ
  remarks            TEXT
  INDEX(tenant_id, parent_phone, dob)      duplicate check
```

## 8. Students & parents

```
students
  campus_id          UUID FK
  admission_no       VARCHAR(30)           UQ(tenant_id, admission_no)
  university_reg_no  VARCHAR(30) NULL      college/PU register no
  application_id     UUID FK NULL
  user_id            UUID FK → users NULL  (student login)
  first_name, last_name  VARCHAR(80)
  name_local         VARCHAR(150)
  dob                DATE
  gender             VARCHAR(10)
  blood_group        VARCHAR(5)
  category, religion, nationality, mother_tongue  VARCHAR(30)
  aadhaar_last4      CHAR(4)               full number NOT stored
  apaar_id           VARCHAR(20) NULL
  phone, email       VARCHAR
  address, city, district, state, pincode
  admission_date     DATE
  photo_file_id      UUID
  status             VARCHAR(20)  ACTIVE | TRANSFERRED | WITHDRAWN | PASSED_OUT | DETAINED | DISCONTINUED
  INDEX(tenant_id, campus_id, status) ; trigram index on name for search

guardians
  user_id            UUID FK → users NULL  (parent login)
  full_name          VARCHAR(150)
  name_local         VARCHAR(150)
  phone              VARCHAR(15)
  alt_phone          VARCHAR(15)
  email              VARCHAR(150)
  occupation         VARCHAR(100)
  annual_income      NUMERIC(14,2) NULL
  address            TEXT
  INDEX(tenant_id, phone)

student_guardians
  student_id, guardian_id  UUID FK
  relationship       VARCHAR(20)  FATHER | MOTHER | GUARDIAN | OTHER
  is_primary         BOOLEAN
  can_login          BOOLEAN
  can_pickup         BOOLEAN               used by hostel home-going & gate pass
  is_verified        BOOLEAN
  UQ(student_id, guardian_id)

student_enrollments
  student_id         UUID FK
  academic_year_id   UUID FK
  section_id         UUID FK
  roll_no            VARCHAR(10)
  start_date         DATE
  end_date           DATE NULL
  status             VARCHAR(20)  ACTIVE | PROMOTED | DETAINED | TRANSFERRED | LEFT | COMPLETED
  UQ(tenant_id, student_id, academic_year_id) WHERE status='ACTIVE'   -- one active enrolment
  INDEX(tenant_id, section_id, status)

student_subjects            -- electives / optional subjects chosen
  enrollment_id      UUID FK
  subject_id         UUID FK
  UQ(enrollment_id, subject_id)

student_status_history
  student_id         UUID FK
  old_status, new_status  VARCHAR(20)
  effective_date     DATE
  reason             VARCHAR(300)
```

## 9. Attendance & leave

**Requirements:** daily or period-wise attendance, one record per student per session, corrections with approval, absent SMS/WhatsApp to parents, leave for students and staff, staff attendance.

```
periods                     -- bell timings (also used by timetable in B2)
  campus_id          UUID FK
  name               VARCHAR(30)
  start_time, end_time  TIME
  sequence           SMALLINT
  is_break           BOOLEAN

attendance_sessions
  campus_id          UUID FK
  section_id         UUID FK
  attendance_date    DATE
  period_id          UUID FK NULL          NULL = daily
  subject_id         UUID FK NULL
  taken_by           UUID FK → employees
  status             VARCHAR(20)  DRAFT | SUBMITTED | LOCKED
  submitted_at       TIMESTAMPTZ
  UQ(tenant_id, section_id, attendance_date, period_id)

attendance_records          (partitioned by month)
  session_id         UUID FK
  student_id         UUID FK
  attendance_date    DATE                  copy, for fast reports
  status             VARCHAR(10)  PRESENT | ABSENT | LATE | HALF_DAY | LEAVE
  remarks            VARCHAR(200)
  parent_notified    BOOLEAN
  UQ(session_id, student_id)
  INDEX(tenant_id, student_id, attendance_date)

attendance_corrections
  record_id          UUID FK
  old_status, new_status  VARCHAR(10)
  reason             VARCHAR(300) NN
  approval_request_id UUID FK NULL
  status             VARCHAR(20)  PENDING | APPROVED | REJECTED

leave_types
  name               VARCHAR(50)
  applies_to         VARCHAR(10)  STUDENT | EMPLOYEE
  is_paid            BOOLEAN               (staff)
  days_per_year      NUMERIC(5,1) NULL

leave_requests
  applicant_type     VARCHAR(10)  STUDENT | EMPLOYEE
  student_id         UUID FK NULL
  employee_id        UUID FK NULL
  leave_type_id      UUID FK
  from_date, to_date DATE
  half_day           BOOLEAN
  days               NUMERIC(5,1)
  reason             TEXT
  applied_by         UUID FK → users       (parent applies for child)
  approval_request_id UUID FK NULL
  status             VARCHAR(20)  PENDING | APPROVED | REJECTED | CANCELLED

staff_attendance
  employee_id        UUID FK
  attendance_date    DATE
  status             VARCHAR(10)  PRESENT | ABSENT | HALF_DAY | LEAVE | ON_DUTY
  check_in, check_out  TIME
  source             VARCHAR(10)  MANUAL | APP
  UQ(tenant_id, employee_id, attendance_date)
```

## 10. Fees & online payment

**Requirements:** fee heads, class-wise structure with instalments, assignment to students, concessions (with approval), invoices, counter collection, Razorpay online payment, receipts, partial payment, late fee, refunds, dues, reminders, cashier day-close.

```
fee_heads
  name               VARCHAR(100)
  code               VARCHAR(20)           UQ(tenant_id, code)
  fee_type           VARCHAR(20)  ACADEMIC | ADMISSION | EXAM | TRANSPORT | HOSTEL | MESS | DEPOSIT | FINE | OTHER
  income_account_id  UUID FK → accounts
  is_refundable      BOOLEAN
  gst_applicable     BOOLEAN               tax code in B4

fee_structures
  campus_id, academic_year_id, program_level_id   UUID FK
  name               VARCHAR(150)
  category           VARCHAR(30) NULL      different fees for categories (e.g. management/merit quota)
  status             VARCHAR(20)  DRAFT | ACTIVE | CLOSED

fee_structure_items
  fee_structure_id   UUID FK
  fee_head_id        UUID FK
  instalment_no      SMALLINT
  amount             NUMERIC(14,2) CHECK(amount >= 0)
  due_date           DATE

late_fee_rules
  campus_id          UUID NULL
  fee_head_id        UUID NULL             NULL = all
  grace_days         SMALLINT
  fine_type          VARCHAR(10)  FIXED | PER_DAY | PERCENT
  fine_value         NUMERIC(10,2)
  max_fine           NUMERIC(14,2) NULL

student_fee_assignments
  student_id         UUID FK
  academic_year_id   UUID FK
  fee_structure_id   UUID FK NULL          NULL for hostel/transport/mess/manual charges
  fee_head_id        UUID FK NULL          used when no structure
  amount             NUMERIC(14,2) NULL    used when no structure
  source_type        VARCHAR(20)  STRUCTURE | HOSTEL | TRANSPORT | MESS | LIBRARY_FINE | DAMAGE | MANUAL
  source_id          UUID NULL             e.g. hostel_allotment id
  CHECK(fee_structure_id IS NOT NULL OR (fee_head_id IS NOT NULL AND amount IS NOT NULL))
  status             VARCHAR(20)  ACTIVE | CANCELLED

concessions
  student_id         UUID FK
  academic_year_id   UUID FK
  fee_head_id        UUID FK NULL          NULL = all heads
  concession_type    VARCHAR(20)  SIBLING | MERIT | STAFF_CHILD | SCHOLARSHIP | MANAGEMENT | OTHER
  value_type         VARCHAR(10)  PERCENT | AMOUNT
  value              NUMERIC(14,2)
  reason             VARCHAR(300)
  approval_request_id UUID FK
  status             VARCHAR(20)  PENDING | APPROVED | REJECTED | CANCELLED

fee_invoices
  campus_id          UUID FK
  invoice_no         VARCHAR(30)           UQ(tenant_id, invoice_no)
  student_id         UUID FK
  academic_year_id   UUID FK
  instalment_no      SMALLINT NULL
  invoice_date, due_date  DATE
  gross_amount       NUMERIC(14,2)
  concession_amount  NUMERIC(14,2)
  fine_amount        NUMERIC(14,2)
  net_amount         NUMERIC(14,2)
  paid_amount        NUMERIC(14,2) default 0
  balance_amount     NUMERIC(14,2)
  status             VARCHAR(20)  UNPAID | PARTIAL | PAID | CANCELLED
  INDEX(tenant_id, student_id, status) ; partial INDEX WHERE status IN ('UNPAID','PARTIAL')

fee_invoice_items
  invoice_id         UUID FK
  fee_head_id        UUID FK
  amount, concession, fine, net_amount, paid_amount   NUMERIC(14,2)

cashier_sessions            -- counter day-close
  campus_id          UUID FK
  cashier_id         UUID FK → users
  opened_at, closed_at  TIMESTAMPTZ
  opening_cash       NUMERIC(14,2)
  system_cash_total  NUMERIC(14,2)
  counted_cash       NUMERIC(14,2)
  difference         NUMERIC(14,2)
  status             VARCHAR(20)  OPEN | CLOSED | VERIFIED

payments
  campus_id          UUID FK
  receipt_no         VARCHAR(30) NULL      given only on SUCCESS   UQ(tenant_id, receipt_no)
  student_id         UUID FK NULL          (NULL for application fee)
  payer_name         VARCHAR(150)
  payment_date       DATE
  amount             NUMERIC(14,2) CHECK(amount > 0)
  payment_mode       VARCHAR(20)  CASH | CHEQUE | DD | UPI | CARD | NETBANKING | ONLINE | BANK_TRANSFER
  reference_no       VARCHAR(100)          cheque no / UTR
  cheque_date        DATE NULL
  bank_name          VARCHAR(100)
  cashier_session_id UUID FK NULL
  idempotency_key    VARCHAR(80)           UQ(tenant_id, idempotency_key)
  status             VARCHAR(20)  PENDING | SUCCESS | FAILED | BOUNCED | CANCELLED
  cancelled_reason   VARCHAR(300)
  journal_entry_id   UUID FK NULL

payment_allocations
  payment_id         UUID FK
  invoice_item_id    UUID FK
  amount             NUMERIC(14,2)

razorpay_orders
  payment_id         UUID FK
  rp_order_id        VARCHAR(50) UQ
  rp_payment_id      VARCHAR(50) UQ NULL   prevents duplicate receipt
  amount             NUMERIC(14,2)
  status             VARCHAR(20)  CREATED | ATTEMPTED | PAID | FAILED
  raw_response       JSONB

payment_webhook_events      -- raw webhook log (idempotent)
  provider           VARCHAR(20)  RAZORPAY
  event_id           VARCHAR(80)
  event_type         VARCHAR(50)
  payload            JSONB
  signature_valid    BOOLEAN
  processed_at       TIMESTAMPTZ NULL
  UQ(provider, event_id)

refunds
  payment_id         UUID FK
  amount             NUMERIC(14,2)
  reason             VARCHAR(300)
  refund_mode        VARCHAR(20)
  rp_refund_id       VARCHAR(50) NULL
  approval_request_id UUID FK
  status             VARCHAR(20)  PENDING | APPROVED | PAID | REJECTED
  journal_entry_id   UUID FK NULL
```

## 11. Accounts: basic posting (full accounting added in B4)

```
financial_years
  name               VARCHAR(20)           2026-27
  start_date, end_date  DATE               Apr–Mar
  is_closed          BOOLEAN

accounts                    -- chart of accounts (seeded template per institution)
  code               VARCHAR(20)           UQ(tenant_id, code)
  name               VARCHAR(150)
  account_type       VARCHAR(20)  ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
  parent_id          UUID FK NULL
  is_group           BOOLEAN               groups can't be posted
  is_system          BOOLEAN               Cash, Bank, Student Receivable …
  campus_id          UUID NULL             optional campus-wise books
  is_active          BOOLEAN

journal_entries
  campus_id          UUID FK NULL
  entry_no           VARCHAR(30)           UQ(tenant_id, entry_no)
  financial_year_id  UUID FK
  entry_date         DATE
  voucher_type       VARCHAR(20)  RECEIPT | PAYMENT | JOURNAL | CONTRA | SALES | PURCHASE
  source_type        VARCHAR(30)           FEE_INVOICE | PAYMENT | REFUND | PAYROLL | VENDOR_BILL | MANUAL
  source_id          UUID NULL
  narration          VARCHAR(500)
  total_amount       NUMERIC(14,2)
  status             VARCHAR(20)  DRAFT | POSTED | REVERSED
  reversal_of_id     UUID FK NULL
  posted_by          UUID, posted_at TIMESTAMPTZ

journal_lines
  journal_entry_id   UUID FK
  account_id         UUID FK
  debit              NUMERIC(14,2) default 0
  credit             NUMERIC(14,2) default 0
  party_type         VARCHAR(20) NULL      STUDENT | VENDOR | EMPLOYEE
  party_id           UUID NULL
  CHECK(debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
  -- SUM(debit) = SUM(credit) per entry, checked before POSTED (service + DB trigger)
```

**Auto entries:** invoice → Dr Student Receivable / Cr Fee Income · payment → Dr Cash/Bank/Razorpay Clearing / Cr Student Receivable · refund → Dr Fee Income (refund) / Cr Bank · cancel → reversal entry.

## 12. Communication (notifications engine, used by every module)

**Requirements:** in-app, push, SMS, WhatsApp, email; English/Kannada templates; announcements to all/campus/class/role; delivery status; opt-out; quiet hours.

```
notification_templates
  event_code         VARCHAR(50)           STUDENT_ABSENT | FEE_DUE | FEE_RECEIPT | PTM_REMINDER …
  channel            VARCHAR(10)  IN_APP | PUSH | SMS | WHATSAPP | EMAIL
  language           VARCHAR(5)   en | kn
  subject            VARCHAR(200)
  body               TEXT                  with {{student_name}} placeholders
  provider_template_id VARCHAR(80)         DLT id / WhatsApp approved template name
  is_active          BOOLEAN
  UQ(tenant_id, event_code, channel, language)

announcements
  campus_id          UUID NULL
  title              VARCHAR(200)
  body               TEXT
  audience_type      VARCHAR(20)  ALL | CAMPUS | PROGRAM | LEVEL | SECTION | ROLE | INDIVIDUAL
  channels           VARCHAR(10)[]
  attachment_file_id UUID NULL
  publish_at         TIMESTAMPTZ
  status             VARCHAR(20)  DRAFT | SCHEDULED | SENT | CANCELLED

announcement_targets
  announcement_id    UUID FK
  target_type        VARCHAR(20)           CAMPUS | SECTION | ROLE | USER …
  target_id          UUID

notifications               -- one per user per message (in-app inbox)
  user_id            UUID FK
  event_code         VARCHAR(50)
  title              VARCHAR(200)
  message            TEXT
  entity_type, entity_id   for deep link
  read_at            TIMESTAMPTZ NULL
  INDEX(tenant_id, user_id, read_at)

notification_deliveries     (partitioned by month)
  notification_id    UUID FK
  channel            VARCHAR(10)
  recipient          VARCHAR(150)          phone / email / device token
  provider           VARCHAR(30)
  provider_msg_id    VARCHAR(100)
  status             VARCHAR(20)  QUEUED | SENT | DELIVERED | READ | FAILED
  error_message      VARCHAR(300)
  attempts           SMALLINT
  cost               NUMERIC(8,4) NULL

user_devices                -- push tokens
  user_id            UUID FK
  push_token         VARCHAR(500) UQ
  platform           VARCHAR(10)  WEB | ANDROID | IOS
  last_seen_at       TIMESTAMPTZ

notification_preferences
  user_id            UUID FK
  event_code         VARCHAR(50)
  channel            VARCHAR(10)
  is_enabled         BOOLEAN               opt-out (mandatory events can't be disabled)
  UQ(tenant_id, user_id, event_code, channel)

message_credits             -- SMS/WhatsApp balance per institution
  channel            VARCHAR(10)
  balance            INT
  last_recharged_at  TIMESTAMPTZ
  UQ(tenant_id, channel)
```

---

**B1 table count: 76** (platform 6 · setup 5 · users 9 · shared 6 · academic 7 · staff 1 · admissions 3 · students 6 · attendance 7 · fees 14 · accounts 4 · communication 8).

---

### Implementation notes (M0.2, 2026-11-14)
Columns added while building M0.2. The migration `m02_platform_services` is the exact source.
- `files`: + `campus_id`, `sha256`, `status` (ACTIVE | DELETED), `deleted_at`; `storage_key` is generated (never contains the uploaded name).
- `notification_templates`: `tenant_id` NULL = platform default; an institution row overrides it.
- `notification_deliveries`: + status `SKIPPED` (opt-out / no address / email not configured), `sent_at`.
- `approval_rules`: + `is_active`.
- `approval_requests`: + `campus_id`, `amount`, `summary`, `total_levels`, `steps` (route snapshot at submission); one PENDING request per record (partial unique index).
- `approval_actions`: action is APPROVE | REJECT (RETURN later); DB trigger blocks the requester; rows are immutable.
- New platform tables: `outbox_events` (event_type, aggregate, payload, dedupe_key, status PENDING | DISPATCHED | FAILED, attempts, last_error) and `processed_events` (consumer, event_id) for idempotent consumers ([ADR-006](../adr/ADR-006-outbox-and-jobs.md)).
