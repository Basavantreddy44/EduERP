# B6: Operations: Table Structure

Common columns implied. Uses B1: `campuses, departments, employees, students, files, approval_requests`. Uses B3: `department_requests`. Uses B4: `vendors, vendor_bills, accounts`.

---

## 1. Inventory & purchase

**Requirements:**
- Item master, multiple stores per campus, stock per store.
- Purchase request (from department / department request) → quotations → comparison → purchase order (approval by amount) → goods receipt with accepted/rejected qty → stock in → vendor bill (B4, 3-way match).
- Stock issue to departments (linked to B3 department requests), transfer between stores, physical stock count with adjustment approval, low-stock alerts.
- Valuation: weighted average.

```
item_categories
  name               VARCHAR(100)          Stationery | Lab consumables | Furniture | Cleaning | IT
  parent_id          UUID FK NULL

inventory_items
  item_code          VARCHAR(30)           UQ(tenant_id, item_code)
  name               VARCHAR(200)
  category_id        UUID FK
  unit               VARCHAR(20)           PCS | BOX | KG | LTR | REAM
  item_type          VARCHAR(20)  CONSUMABLE | ASSET | LAB_EQUIPMENT
  hsn_code           VARCHAR(10)
  tax_code_id        UUID FK NULL
  reorder_level      NUMERIC(14,2)
  expense_account_id UUID FK → accounts
  is_active          BOOLEAN

stores
  campus_id          UUID FK
  name               VARCHAR(100)          Main Store | Lab Store | Hostel Store | Kitchen
  store_keeper_id    UUID FK → employees
  UQ(tenant_id, campus_id, name)

stock_balances
  store_id           UUID FK
  item_id            UUID FK
  quantity           NUMERIC(14,2)         CHECK(quantity >= 0)
  avg_cost           NUMERIC(14,4)
  UQ(store_id, item_id)
  -- updated only through stock_transactions (same DB transaction, row locked)

purchase_requests
  campus_id          UUID FK
  pr_no              VARCHAR(30)           UQ(tenant_id, pr_no)
  department_id      UUID FK
  department_request_id UUID FK NULL       B3 link
  requested_by       UUID FK
  required_by        DATE
  justification      VARCHAR(500)
  estimated_total    NUMERIC(14,2)
  approval_request_id UUID FK
  status             VARCHAR(20)  DRAFT | SUBMITTED | APPROVED | REJECTED | ORDERED | CLOSED

purchase_request_items
  pr_id              UUID FK
  item_id            UUID FK
  quantity           NUMERIC(14,2)
  estimated_rate     NUMERIC(14,2)

quotations
  pr_id              UUID FK
  vendor_id          UUID FK
  quotation_no       VARCHAR(50)
  quotation_date     DATE
  valid_till         DATE
  total_amount       NUMERIC(14,2)
  delivery_days      SMALLINT
  payment_terms      VARCHAR(200)
  is_selected        BOOLEAN
  selection_reason   VARCHAR(300)          (comparative statement result)

quotation_items
  quotation_id       UUID FK
  pr_item_id         UUID FK
  rate               NUMERIC(14,2)
  tax_percent        NUMERIC(5,2)
  amount             NUMERIC(14,2)

purchase_orders
  campus_id          UUID FK
  po_no              VARCHAR(30)           UQ(tenant_id, po_no)
  vendor_id          UUID FK
  pr_id              UUID FK NULL
  quotation_id       UUID FK NULL
  po_date            DATE
  delivery_date      DATE
  delivery_store_id  UUID FK → stores
  sub_total, tax_amount, total_amount  NUMERIC(14,2)
  terms              TEXT
  approval_request_id UUID FK              level by amount (approval_rules)
  status             VARCHAR(20)  DRAFT | PENDING_APPROVAL | APPROVED | SENT | PARTIAL_RECEIVED | RECEIVED | CLOSED | CANCELLED

purchase_order_items
  po_id              UUID FK
  item_id            UUID FK
  quantity           NUMERIC(14,2)
  rate               NUMERIC(14,2)
  tax_code_id        UUID FK NULL
  amount             NUMERIC(14,2)
  received_qty       NUMERIC(14,2) default 0   CHECK(received_qty <= quantity * 1.05)  tolerance setting

goods_receipts
  campus_id          UUID FK
  grn_no             VARCHAR(30)           UQ(tenant_id, grn_no)
  po_id              UUID FK
  store_id           UUID FK
  receipt_date       DATE
  vendor_challan_no  VARCHAR(50)
  received_by        UUID FK
  inspected_by       UUID FK NULL
  status             VARCHAR(20)  DRAFT | INSPECTED | POSTED

goods_receipt_items
  grn_id             UUID FK
  po_item_id         UUID FK
  received_qty, accepted_qty, rejected_qty  NUMERIC(14,2)
  rejection_reason   VARCHAR(200)
  CHECK(accepted_qty + rejected_qty = received_qty)
  -- only accepted_qty enters stock

stock_transactions          -- stock ledger (append only)
  store_id           UUID FK
  item_id            UUID FK
  txn_date           TIMESTAMPTZ
  txn_type           VARCHAR(20)  GRN_IN | ISSUE_OUT | TRANSFER_OUT | TRANSFER_IN | RETURN_IN | ADJUST_IN | ADJUST_OUT | CONSUME
  quantity           NUMERIC(14,2)         positive number; direction from txn_type
  rate               NUMERIC(14,4)
  value              NUMERIC(14,2)
  reference_type     VARCHAR(20)  GRN | ISSUE | TRANSFER | COUNT | LAB_BREAKAGE | MESS
  reference_id       UUID
  balance_after      NUMERIC(14,2)
  INDEX(tenant_id, item_id, txn_date)

stock_issues
  campus_id          UUID FK
  issue_no           VARCHAR(30)           UQ(tenant_id, issue_no)
  issue_type         VARCHAR(10)  ISSUE | TRANSFER
  from_store_id      UUID FK
  to_store_id        UUID FK NULL          transfer
  to_department_id   UUID FK NULL          issue
  department_request_id UUID FK NULL       B3 link
  issued_to_employee_id UUID FK NULL
  issue_date         DATE
  status             VARCHAR(20)  DRAFT | ISSUED | RECEIVED | CANCELLED

stock_issue_items
  issue_id           UUID FK
  item_id            UUID FK
  quantity           NUMERIC(14,2)
  returnable         BOOLEAN

stock_counts                -- physical verification
  store_id           UUID FK
  count_date         DATE
  item_id            UUID FK
  system_qty, counted_qty, difference  NUMERIC(14,2)
  approval_request_id UUID FK NULL         adjustment approval
  status             VARCHAR(20)  COUNTED | APPROVED | ADJUSTED
```

## 2. Labs

**Requirements:** labs per campus, equipment register (with condition and calibration), practical sessions/bookings per batch, breakage register (charge to student via fees), consumables drawn from the lab store (stock issue).

```
labs
  campus_id          UUID FK
  name               VARCHAR(100)          Physics Lab | Computer Lab 1
  room_id            UUID FK → rooms NULL
  department_id      UUID FK
  incharge_employee_id UUID FK
  lab_assistant_employee_id UUID FK NULL
  capacity           SMALLINT

lab_equipment
  lab_id             UUID FK
  item_id            UUID FK → inventory_items NULL
  name               VARCHAR(200)
  asset_tag          VARCHAR(50)           UQ(tenant_id, asset_tag)
  quantity           SMALLINT
  condition          VARCHAR(20)  WORKING | NEEDS_REPAIR | DAMAGED | DISPOSED
  last_calibration_date DATE NULL
  next_calibration_date DATE NULL

lab_sessions                -- practical schedule / bookings
  lab_id             UUID FK
  section_id         UUID FK
  subject_id         UUID FK
  batch_name         VARCHAR(20)           Batch A / B
  employee_id        UUID FK
  session_date       DATE
  start_time, end_time  TIME
  experiment_title   VARCHAR(200)
  status             VARCHAR(20)  SCHEDULED | COMPLETED | CANCELLED
  -- service check: no overlapping sessions in the same lab

lab_breakages
  lab_id             UUID FK
  equipment_id       UUID FK NULL
  item_description   VARCHAR(200)
  student_id         UUID FK NULL
  breakage_date      DATE
  quantity           SMALLINT
  charge_amount      NUMERIC(14,2)
  fee_assignment_id  UUID FK NULL          charged to student fees
  status             VARCHAR(20)  REPORTED | CHARGED | WAIVED
```

## 3. Sports & activities

**Requirements:** sports and clubs (NCC, NSS, music, robotics), coaches, student membership/teams, competitions (inter-house, inter-school, state), participation and results, achievements (also posted to news feed, shown on student profile).

```
activities
  campus_id          UUID FK
  name               VARCHAR(100)          Cricket | NSS | Robotics Club
  activity_type      VARCHAR(10)  SPORT | CLUB | HOUSE
  coordinator_employee_id UUID FK
  is_active          BOOLEAN

activity_members
  activity_id        UUID FK
  student_id         UUID FK
  academic_year_id   UUID FK
  team_name          VARCHAR(50) NULL      U-14 Team / Red House
  member_role        VARCHAR(20)  MEMBER | CAPTAIN | VICE_CAPTAIN | SECRETARY
  UQ(activity_id, student_id, academic_year_id)

competitions
  activity_id        UUID FK
  event_id           UUID FK → events NULL B3 link
  name               VARCHAR(200)
  level              VARCHAR(20)  INTRA | INTER_SCHOOL | ZONAL | DISTRICT | STATE | NATIONAL | INTERNATIONAL
  venue              VARCHAR(200)
  start_date, end_date  DATE

competition_participants
  competition_id     UUID FK
  student_id         UUID FK
  category           VARCHAR(100)          100m U-14 / Singles
  result             VARCHAR(20)  PARTICIPATED | WINNER | RUNNER_UP | THIRD | SPECIAL
  UQ(competition_id, student_id, category)

achievements
  student_id         UUID FK NULL
  employee_id        UUID FK NULL          staff awards too
  title              VARCHAR(200)
  category           VARCHAR(20)  SPORTS | ACADEMIC | CULTURAL | NCC_NSS | OTHER
  level              VARCHAR(20)
  achievement_date   DATE
  competition_participant_id UUID FK NULL
  certificate_file_id UUID NULL
  feed_post_id       UUID FK NULL          auto/optional feed post
  is_verified        BOOLEAN
```

## 4. Placements (college)

**Requirements:** companies, placement drives with eligibility (programme, min CGPA, max backlogs, batch), student placement profile and resume, eligible students apply, round-wise status, offers (CTC), placement statistics.

```
companies
  name               VARCHAR(200)
  industry           VARCHAR(100)
  website            VARCHAR(200)
  hr_name, hr_email, hr_phone
  address            TEXT
  status             VARCHAR(20)  ACTIVE | BLACKLISTED

student_placement_profiles
  student_id         UUID FK UQ
  resume_file_id     UUID NULL
  skills             VARCHAR(500)
  preferred_locations VARCHAR(200)
  is_opted_in        BOOLEAN
  is_placed          BOOLEAN

placement_drives
  campus_id          UUID FK
  company_id         UUID FK
  title              VARCHAR(200)          job role
  job_type           VARCHAR(20)  FULL_TIME | INTERNSHIP
  ctc_min, ctc_max   NUMERIC(14,2)
  eligible_program_ids UUID[]
  passing_year       SMALLINT
  min_cgpa           NUMERIC(4,2) NULL
  max_backlogs       SMALLINT NULL
  last_date_to_apply DATE
  drive_date         DATE
  rounds             JSONB                 ["Aptitude","Technical","HR"]
  status             VARCHAR(20)  DRAFT | OPEN | CLOSED | COMPLETED

placement_applications
  drive_id           UUID FK
  student_id         UUID FK
  applied_at         TIMESTAMPTZ
  eligibility_snapshot JSONB               cgpa/backlogs at time of applying
  current_round      VARCHAR(50)
  status             VARCHAR(20)  APPLIED | SHORTLISTED | IN_PROCESS | SELECTED | REJECTED | WITHDRAWN
  UQ(drive_id, student_id)

placement_offers
  application_id     UUID FK UQ
  ctc                NUMERIC(14,2)
  offer_date         DATE
  joining_date       DATE NULL
  offer_letter_file_id UUID NULL
  status             VARCHAR(20)  OFFERED | ACCEPTED | DECLINED | REVOKED
```

## 5. Reports & exports

**Requirements:** role dashboards and standard reports per module (built with SQL views and queries, so no table per report). Users can save filters and export Excel/PDF in the background, with the export logged.

```
saved_reports
  user_id            UUID FK
  report_code        VARCHAR(50)           FEE_DUES | ATTENDANCE_SUMMARY …
  name               VARCHAR(150)
  filters            JSONB
  is_shared          BOOLEAN
  schedule_cron      VARCHAR(50) NULL      emailed automatically

export_jobs
  user_id            UUID FK
  report_code        VARCHAR(50)
  filters            JSONB
  format             VARCHAR(10)  XLSX | PDF | CSV
  row_count          INT
  file_id            UUID NULL
  expires_at         TIMESTAMPTZ           download link expiry
  status             VARCHAR(20)  QUEUED | RUNNING | DONE | FAILED
```

---

**B6 table count: 32** (inventory & purchase 16 · labs 4 · sports 5 · placements 5 · reports 2).
