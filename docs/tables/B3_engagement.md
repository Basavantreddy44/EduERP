# B3: Engagement: Table Structure

Common columns implied. Uses B1: `users, students, guardians, employees, sections, departments, campuses, files, notifications, approval_requests`.

---

## 1. News feed (social-style, moderated)

**Requirements:** admin and teachers post text, photos, videos and PDFs to the institution, a campus or a class. Parents and students see only posts targeted to them. Likes/reactions and comments. Moderation: posts by teachers (setting) and comments can need approval. Report abuse. Pin important posts. Event and achievement posts link to their records.

```
feed_posts
  campus_id          UUID NULL
  author_user_id     UUID FK → users
  post_type          VARCHAR(20)  GENERAL | ACHIEVEMENT | EVENT | NEWS | GALLERY | CIRCULAR
  title              VARCHAR(200) NULL
  body               TEXT
  linked_entity_type VARCHAR(30) NULL      EVENT | ACHIEVEMENT | SPORT_EVENT
  linked_entity_id   UUID NULL
  allow_comments     BOOLEAN
  is_pinned          BOOLEAN
  status             VARCHAR(20)  DRAFT | PENDING_APPROVAL | PUBLISHED | REJECTED | HIDDEN
  approved_by        UUID FK NULL
  published_at       TIMESTAMPTZ
  reaction_count, comment_count  INT       cached counters
  INDEX(tenant_id, status, published_at DESC)

feed_post_media
  post_id            UUID FK
  file_id            UUID FK → files
  media_type         VARCHAR(10)  IMAGE | VIDEO | PDF
  thumbnail_file_id  UUID NULL
  sort_order         SMALLINT

feed_post_targets           -- who can see it
  post_id            UUID FK
  target_type        VARCHAR(20)  ALL | CAMPUS | PROGRAM | LEVEL | SECTION | ROLE
  target_id          UUID NULL
  INDEX(tenant_id, target_type, target_id)

feed_reactions              (partitioned by month at scale)
  post_id            UUID FK
  user_id            UUID FK
  reaction           VARCHAR(10)  LIKE | LOVE | CLAP | CELEBRATE
  UQ(post_id, user_id)

feed_comments
  post_id            UUID FK
  user_id            UUID FK
  parent_comment_id  UUID FK NULL          one level of replies
  comment            VARCHAR(1000)
  status             VARCHAR(20)  PENDING | VISIBLE | HIDDEN | DELETED
  moderated_by       UUID NULL

feed_reports                -- abuse reports
  post_id            UUID FK NULL
  comment_id         UUID FK NULL
  reported_by        UUID FK
  reason             VARCHAR(30)  SPAM | ABUSIVE | INAPPROPRIATE | PRIVACY | OTHER
  details            VARCHAR(500)
  status             VARCHAR(20)  OPEN | ACTION_TAKEN | DISMISSED
  reviewed_by        UUID NULL
```

**Rules:** parents see posts targeted to their child's section/level/campus/ALL. Student photos in posts follow the institution's photo-consent setting.

## 2. Events & calendar

**Requirements:** institution and campus events (annual day, sports day, field trips, exams, PTMs), with audience, registration/RSVP and photos posted to the feed afterwards. The calendar combines events, holidays, exam schedules, PTMs and meetings.

```
events
  campus_id          UUID NULL
  title              VARCHAR(200)
  description        TEXT
  event_type         VARCHAR(20)  CULTURAL | SPORTS | ACADEMIC | TRIP | CELEBRATION | WORKSHOP | OTHER
  start_at, end_at   TIMESTAMPTZ
  all_day            BOOLEAN
  venue              VARCHAR(200)
  organiser_employee_id UUID FK NULL
  registration_required BOOLEAN
  max_participants   INT NULL
  fee_head_id        UUID FK NULL          paid trips/events → fee charge
  fee_amount         NUMERIC(14,2) NULL
  requires_parent_consent BOOLEAN          e.g. trips
  status             VARCHAR(20)  DRAFT | PUBLISHED | CANCELLED | COMPLETED

event_targets
  event_id           UUID FK
  target_type        VARCHAR(20)  ALL | CAMPUS | LEVEL | SECTION | ROLE
  target_id          UUID NULL

event_participants
  event_id           UUID FK
  participant_type   VARCHAR(10)  STUDENT | EMPLOYEE | GUARDIAN
  participant_id     UUID
  rsvp_status        VARCHAR(10)  GOING | NOT_GOING | MAYBE | REGISTERED
  parent_consent     VARCHAR(10)  NA | PENDING | GIVEN | DENIED
  attended           BOOLEAN NULL
  UQ(event_id, participant_type, participant_id)
```

## 3. Parent-Teacher Meetings (PTM)

**Requirements:** admin creates a PTM day. Teachers publish time slots. Parents book a slot for their child. Reminders. Teacher marks attended and records notes. One booking per child per teacher per PTM.

```
ptm_sessions
  campus_id          UUID FK
  academic_year_id   UUID FK
  title              VARCHAR(200)          "Term 1 PTM"
  ptm_date           DATE
  start_time, end_time  TIME
  slot_minutes       SMALLINT              e.g. 10
  mode               VARCHAR(10)  IN_PERSON | ONLINE | BOTH
  booking_opens_at, booking_closes_at  TIMESTAMPTZ
  target_levels      UUID[]                program_levels included
  status             VARCHAR(20)  DRAFT | OPEN | CLOSED | COMPLETED

ptm_slots
  ptm_session_id     UUID FK
  employee_id        UUID FK               teacher
  slot_start, slot_end  TIME
  room               VARCHAR(30)
  meeting_link       VARCHAR(500) NULL
  is_blocked         BOOLEAN
  UQ(ptm_session_id, employee_id, slot_start)

ptm_bookings
  slot_id            UUID FK  UQ           one booking per slot
  student_id         UUID FK
  guardian_id        UUID FK
  status             VARCHAR(20)  BOOKED | CANCELLED | ATTENDED | NO_SHOW
  teacher_notes      TEXT
  parent_feedback    VARCHAR(500)
  -- rule: one booking per student per teacher per ptm_session (service check)
```

## 4. Staff / department / committee meetings & minutes

**Requirements:** schedule a meeting, invite staff or a committee, agenda, RSVP, attendance, minutes of meeting (MoM), action items with owner and due date and follow-up reminders. Recurring committees (e.g. Discipline Committee, IQAC).

```
committees
  campus_id          UUID NULL
  name               VARCHAR(150)          IQAC | Anti-ragging | Exam committee …
  description        VARCHAR(500)
  is_active          BOOLEAN

committee_members
  committee_id       UUID FK
  employee_id        UUID FK
  member_role        VARCHAR(20)  CHAIR | SECRETARY | MEMBER
  UQ(committee_id, employee_id)

meetings
  campus_id          UUID NULL
  meeting_type       VARCHAR(20)  STAFF | DEPARTMENT | COMMITTEE | MANAGEMENT | OTHER
  committee_id       UUID FK NULL
  department_id      UUID FK NULL
  title              VARCHAR(200)
  start_at, end_at   TIMESTAMPTZ
  venue              VARCHAR(200)
  meeting_link       VARCHAR(500) NULL
  organiser_user_id  UUID FK
  status             VARCHAR(20)  SCHEDULED | COMPLETED | CANCELLED | POSTPONED

meeting_participants
  meeting_id         UUID FK
  user_id            UUID FK
  rsvp_status        VARCHAR(10)  PENDING | ACCEPTED | DECLINED
  attended           BOOLEAN NULL
  UQ(meeting_id, user_id)

meeting_agenda_items
  meeting_id         UUID FK
  item_no            SMALLINT
  title              VARCHAR(300)
  presenter_user_id  UUID NULL

meeting_minutes
  meeting_id         UUID FK UQ
  minutes_text       TEXT
  recorded_by        UUID FK
  approved_by        UUID FK NULL
  status             VARCHAR(20)  DRAFT | CIRCULATED | APPROVED
  -- attachments: files(entity_type='MEETING')

meeting_action_items
  meeting_id         UUID FK
  agenda_item_id     UUID FK NULL
  description        VARCHAR(500)
  owner_user_id      UUID FK
  due_date           DATE
  status             VARCHAR(20)  OPEN | IN_PROGRESS | DONE | CANCELLED
  completed_at       TIMESTAMPTZ NULL
```

## 5. Complaints / grievance

**Requirements:** parents, students and staff raise complaints (optionally anonymous for students). Categorised, auto-assigned to the department, SLA, status updates, closure, satisfaction rating, escalation if overdue.

```
complaint_categories
  name               VARCHAR(100)          Academic | Transport | Hostel | Fees | Facilities | Harassment …
  department_id      UUID FK               default assignment
  sla_hours          INT
  is_sensitive       BOOLEAN               restricted visibility (e.g. harassment → committee only)

complaints
  campus_id          UUID FK
  complaint_no       VARCHAR(30)           UQ(tenant_id, complaint_no)
  category_id        UUID FK
  raised_by_user_id  UUID FK
  raised_by_type     VARCHAR(10)  PARENT | STUDENT | STAFF
  student_id         UUID FK NULL          related student
  is_anonymous       BOOLEAN
  subject            VARCHAR(200)
  description        TEXT
  priority           VARCHAR(10)  LOW | MEDIUM | HIGH | URGENT
  assigned_to        UUID FK NULL
  due_at             TIMESTAMPTZ           from SLA
  status             VARCHAR(20)  OPEN | ASSIGNED | IN_PROGRESS | RESOLVED | CLOSED | REOPENED | ESCALATED
  resolved_at        TIMESTAMPTZ
  satisfaction_rating SMALLINT NULL        1–5

complaint_updates
  complaint_id       UUID FK
  updated_by         UUID FK
  update_type        VARCHAR(20)  COMMENT | STATUS_CHANGE | ASSIGNMENT | ESCALATION
  message            TEXT
  is_internal        BOOLEAN               hidden from complainant
  old_status, new_status  VARCHAR(20)
```

## 6. Front office

**Requirements:** visitor log (with photo, purpose, whom to meet, in/out time), gate pass for students leaving early (only to authorised pickup persons) and for staff, call log, postal register (inward/outward). Security staff use the mobile web.

```
visitors
  campus_id          UUID FK
  visitor_name       VARCHAR(150)
  phone              VARCHAR(15)
  id_proof_type      VARCHAR(20)
  id_proof_last4     VARCHAR(4)
  photo_file_id      UUID NULL
  purpose            VARCHAR(30)  PARENT_VISIT | ADMISSION | VENDOR | INTERVIEW | OFFICIAL | OTHER
  whom_to_meet_user_id UUID FK NULL
  student_id         UUID FK NULL
  in_time            TIMESTAMPTZ
  out_time           TIMESTAMPTZ NULL
  visitor_pass_no    VARCHAR(20)
  vehicle_no         VARCHAR(20)
  recorded_by        UUID FK
  INDEX(tenant_id, campus_id, in_time)

gate_passes
  campus_id          UUID FK
  pass_no            VARCHAR(30)
  pass_type          VARCHAR(10)  STUDENT | STAFF
  student_id         UUID FK NULL
  employee_id        UUID FK NULL
  reason             VARCHAR(300)
  pickup_guardian_id UUID FK NULL          must have can_pickup = true
  pickup_person_name VARCHAR(150) NULL     if not a guardian → needs approval
  out_time           TIMESTAMPTZ
  expected_return    TIMESTAMPTZ NULL
  actual_return      TIMESTAMPTZ NULL
  approval_request_id UUID FK NULL
  verified_by_security UUID FK NULL
  status             VARCHAR(20)  REQUESTED | APPROVED | REJECTED | OUT | RETURNED | CANCELLED

call_logs
  campus_id          UUID FK
  call_type          VARCHAR(10)  INCOMING | OUTGOING
  caller_name        VARCHAR(150)
  phone              VARCHAR(15)
  purpose            VARCHAR(300)
  call_time          TIMESTAMPTZ
  duration_minutes   SMALLINT
  follow_up_required BOOLEAN
  follow_up_date     DATE NULL
  recorded_by        UUID FK

postal_records
  campus_id          UUID FK
  direction          VARCHAR(10)  INWARD | OUTWARD
  reference_no       VARCHAR(50)
  from_party, to_party  VARCHAR(200)
  courier_name       VARCHAR(100)
  tracking_no        VARCHAR(50)
  record_date        DATE
  addressed_to_user_id UUID FK NULL
  handed_over_at     TIMESTAMPTZ NULL
  remarks            VARCHAR(300)
```

## 7. Department requests (inter-department)

**Requirements:** any department raises a request to another department (Store: items, Maintenance: repairs, IT: support, Transport: vehicle). Approval, assignment, status tracking, closure. Store requests connect to stock issue (B6).

```
request_categories
  name               VARCHAR(100)          Stationery | Repair | IT Support | Vehicle …
  to_department_id   UUID FK               which department handles it
  requires_approval  BOOLEAN
  sla_hours          INT

department_requests
  campus_id          UUID FK
  request_no         VARCHAR(30)           UQ(tenant_id, request_no)
  from_department_id UUID FK
  to_department_id   UUID FK
  category_id        UUID FK
  requested_by       UUID FK
  title              VARCHAR(200)
  description        TEXT
  priority           VARCHAR(10)  LOW | MEDIUM | HIGH | URGENT
  needed_by          DATE
  items              JSONB NULL            [{item_id, qty}] for store requests → B6 stock issue
  approval_request_id UUID FK NULL
  assigned_to        UUID FK NULL
  status             VARCHAR(20)  OPEN | APPROVED | REJECTED | ASSIGNED | IN_PROGRESS | COMPLETED | CLOSED

department_request_updates
  request_id         UUID FK
  updated_by         UUID FK
  message            TEXT
  old_status, new_status  VARCHAR(20)
```

---

**B3 table count: 29** (news feed 6 · events 3 · PTM 3 · meetings 7 · complaints 3 · front office 4 · department requests 3; the calendar is a combined view, so it has no table).
