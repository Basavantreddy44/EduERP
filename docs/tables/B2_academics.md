# B2: Academics: Table Structure

Common columns implied. Uses B1 tables: `sections, program_levels, subjects, level_subjects, employees, students, student_enrollments, periods, files, approval_requests, notifications`.

---

## 1. Timetable

**Requirements:** weekly timetable per section, rooms, no teacher, room or section clash, publish/version, substitution when a teacher is absent (with notification).

```
rooms
  campus_id          UUID FK
  name               VARCHAR(50)           UQ(tenant_id, campus_id, name)
  room_type          VARCHAR(20)  CLASSROOM | LAB | HALL | LIBRARY | STAFF_ROOM
  capacity           INT
  building, floor    VARCHAR(30)

timetables
  academic_year_id   UUID FK
  section_id         UUID FK
  effective_from     DATE
  effective_to       DATE NULL
  version            SMALLINT
  status             VARCHAR(20)  DRAFT | PUBLISHED | ARCHIVED
  published_by, published_at

timetable_entries
  timetable_id       UUID FK
  day_of_week        SMALLINT  1–7
  period_id          UUID FK
  subject_id         UUID FK
  employee_id        UUID FK
  room_id            UUID FK NULL
  UQ(timetable_id, day_of_week, period_id)                      -- section clash
  -- teacher & room clash across PUBLISHED timetables: checked in service (+ exclusion constraint)

substitutions
  timetable_entry_id UUID FK
  substitution_date  DATE
  absent_employee_id UUID FK
  substitute_employee_id UUID FK
  reason             VARCHAR(200)
  status             VARCHAR(20)  ASSIGNED | CANCELLED
  UQ(timetable_entry_id, substitution_date)
```

## 2. Homework & assignments

**Requirements:** teacher gives homework to a section or students with attachments and a due date. Students submit online (files/text). The teacher grades and gives feedback. Parents get notified.

```
homework
  section_id         UUID FK
  subject_id         UUID FK
  employee_id        UUID FK
  title              VARCHAR(200)
  description        TEXT
  homework_type      VARCHAR(20)  HOMEWORK | ASSIGNMENT | PROJECT
  assigned_date      DATE
  due_date           TIMESTAMPTZ
  submission_required BOOLEAN
  max_marks          NUMERIC(6,2) NULL
  allow_late         BOOLEAN
  status             VARCHAR(20)  DRAFT | PUBLISHED | CLOSED
  -- attachments: files(entity_type='HOMEWORK')

homework_submissions
  homework_id        UUID FK
  student_id         UUID FK
  submitted_at       TIMESTAMPTZ
  answer_text        TEXT
  is_late            BOOLEAN
  marks              NUMERIC(6,2) NULL
  feedback           TEXT
  checked_by         UUID FK NULL
  status             VARCHAR(20)  PENDING | SUBMITTED | CHECKED | RESUBMIT
  UQ(homework_id, student_id)
  -- attachments: files(entity_type='HOMEWORK_SUBMISSION')
```

## 3. Class diary

**Requirements:** daily diary or remarks from teacher to parents, for a whole class or one student. Parent acknowledges.

```
class_diary_entries
  section_id         UUID FK
  student_id         UUID FK NULL          NULL = whole class
  employee_id        UUID FK
  diary_date         DATE
  entry_type         VARCHAR(20)  GENERAL | REMARK | APPRECIATION | REMINDER
  message            TEXT
  requires_ack       BOOLEAN
  acknowledged_at    TIMESTAMPTZ NULL      (student-specific entries)
  acknowledged_by    UUID NULL
```

## 4. Lesson plans & syllabus tracking

```
syllabus_units
  program_level_id   UUID FK
  subject_id         UUID FK
  academic_year_id   UUID FK
  unit_no            SMALLINT
  title              VARCHAR(200)
  planned_hours      NUMERIC(5,1)

syllabus_topics
  unit_id            UUID FK
  topic_no           SMALLINT
  title              VARCHAR(300)

lesson_plans
  section_id         UUID FK
  subject_id         UUID FK
  employee_id        UUID FK
  topic_id           UUID FK
  planned_date       DATE
  objectives         TEXT
  teaching_method    VARCHAR(100)
  resources          TEXT
  status             VARCHAR(20)  PLANNED | COMPLETED | POSTPONED
  approved_by        UUID FK NULL          HOD review (optional setting)

syllabus_progress
  section_id         UUID FK
  topic_id           UUID FK
  completed_date     DATE
  employee_id        UUID FK
  remarks            VARCHAR(300)
  UQ(section_id, topic_id)
  -- % completion = completed topics / total topics (report)
```

## 5. Study material / LMS

```
study_materials
  program_level_id   UUID FK
  section_id         UUID FK NULL          NULL = all sections of level
  subject_id         UUID FK
  topic_id           UUID FK NULL
  title              VARCHAR(200)
  material_type      VARCHAR(20)  NOTES | PDF | VIDEO | LINK | PPT | QUESTION_BANK
  url                VARCHAR(500) NULL     (YouTube/Drive link) — files for uploads
  uploaded_by        UUID FK
  is_published       BOOLEAN

material_views
  material_id        UUID FK
  student_id         UUID FK
  first_viewed_at, last_viewed_at  TIMESTAMPTZ
  view_count         INT
  UQ(material_id, student_id)

online_classes
  section_id         UUID FK
  subject_id         UUID FK
  employee_id        UUID FK
  title              VARCHAR(200)
  start_time, end_time  TIMESTAMPTZ
  meeting_link       VARCHAR(500)          Zoom/Meet link (pasted)
  recording_url      VARCHAR(500) NULL
  status             VARCHAR(20)  SCHEDULED | COMPLETED | CANCELLED
```

## 6. Examinations & results (CBSE · Karnataka State · Karnataka PU · University CBCS)

**Requirements:** each board has its own scheme, configured, not hard-coded.

| Board | Scheme example (configured as data) |
|---|---|
| CBSE | Term-wise: Periodic Test + Notebook + Subject Enrichment + Half-Yearly/Annual; grades A1–E; co-scholastic grades |
| Karnataka State (SSLC) | FA1–FA4 + SA1/SA2; marks + grades |
| Karnataka PU | Unit tests, Mid-term, Preparatory; theory + practical; marks, pass per subject |
| University CBCS | Internal Assessment (IA) + End-Semester Exam (ESE) + practical; grade points × credits → SGPA, CGPA; backlogs |

```
grade_scales
  name               VARCHAR(50)           "CBSE 9-point", "CBCS 10-point"
  scale_type         VARCHAR(10)  PERCENT | POINTS

grade_scale_items
  grade_scale_id     UUID FK
  grade              VARCHAR(5)            A1, A2, O, A+, F …
  min_percent, max_percent  NUMERIC(5,2)
  grade_point        NUMERIC(4,2)
  description        VARCHAR(50)           Outstanding …
  is_fail            BOOLEAN

assessment_schemes
  board_id           UUID FK → education_boards
  name               VARCHAR(100)
  result_method      VARCHAR(10)  MARKS | GRADES | CBCS
  grade_scale_id     UUID FK
  pass_percent       NUMERIC(5,2)          overall pass
  subject_pass_percent NUMERIC(5,2)
  rounding_rule      VARCHAR(20)  NONE | ROUND | CEIL
  applies_to_levels  UUID[]                program_level ids

assessment_components
  scheme_id          UUID FK
  name               VARCHAR(80)           Periodic Test 1 | IA | ESE | Practical
  code               VARCHAR(20)
  term               VARCHAR(20) NULL      TERM_1 | TERM_2 | SEM
  weightage_percent  NUMERIC(5,2)          contribution to final
  max_marks          NUMERIC(6,2)
  is_internal        BOOLEAN

exams
  campus_id          UUID FK
  academic_year_id   UUID FK
  scheme_id          UUID FK
  component_id       UUID FK               which component this exam fills
  name               VARCHAR(100)
  start_date, end_date  DATE
  status             VARCHAR(20)  DRAFT | SCHEDULED | MARKS_ENTRY | VERIFIED | PUBLISHED | CLOSED

exam_subjects               -- schedule per level & subject
  exam_id            UUID FK
  program_level_id   UUID FK
  subject_id         UUID FK
  exam_date          DATE
  start_time, end_time  TIME
  max_marks          NUMERIC(6,2)
  pass_marks         NUMERIC(6,2)          CHECK(pass_marks <= max_marks)
  marks_entry_by     UUID FK NULL          assigned teacher
  marks_status       VARCHAR(20)  PENDING | ENTERED | VERIFIED
  UQ(exam_id, program_level_id, subject_id)

exam_marks
  exam_subject_id    UUID FK
  student_id         UUID FK
  marks_obtained     NUMERIC(6,2) NULL     CHECK(<= max_marks, in service)
  attendance_code    VARCHAR(10)  PRESENT | ABSENT | MALPRACTICE | EXEMPT
  entered_by, entered_at
  verified_by, verified_at
  UQ(exam_subject_id, student_id)
  -- after PUBLISHED: changes only via revaluation → new result version

co_scholastic_areas         -- CBSE etc.
  scheme_id          UUID FK
  name               VARCHAR(80)           Work Education | Art | Health & PE | Discipline
  grade_scale_id     UUID FK

co_scholastic_grades
  area_id            UUID FK
  student_id         UUID FK
  academic_year_id   UUID FK
  term               VARCHAR(20)
  grade              VARCHAR(5)
  UQ(area_id, student_id, academic_year_id, term)

exam_results                -- per student per term/final (school & PU)
  academic_year_id   UUID FK
  student_id         UUID FK
  section_id         UUID FK
  scheme_id          UUID FK
  term               VARCHAR(20)           TERM_1 | FINAL …
  version            SMALLINT default 1
  total_marks, max_total  NUMERIC(8,2)
  percentage         NUMERIC(5,2)
  grade              VARCHAR(5)
  class_rank         INT NULL
  attendance_percent NUMERIC(5,2)
  teacher_remarks    VARCHAR(500)
  result_status      VARCHAR(10)  PASS | FAIL | PROMOTED | DETAINED | WITHHELD
  is_latest          BOOLEAN
  UQ(student_id, academic_year_id, term, version)

exam_result_subjects        -- subject-wise lines on report card
  exam_result_id     UUID FK
  subject_id         UUID FK
  component_marks    JSONB                 {"PT1":18,"NB":5,"SE":4,"HY":72}
  total, max_total   NUMERIC(8,2)
  grade              VARCHAR(5)
  grade_point        NUMERIC(4,2)
  is_pass            BOOLEAN

semester_results            -- CBCS (degree / PG)
  student_id         UUID FK
  program_level_id   UUID FK               semester
  academic_year_id   UUID FK
  version            SMALLINT
  credits_registered, credits_earned  NUMERIC(5,1)
  sgpa               NUMERIC(4,2)
  cgpa               NUMERIC(4,2)
  backlog_count      SMALLINT
  result_status      VARCHAR(10)  PASS | FAIL | ATKT
  is_latest          BOOLEAN
  UQ(student_id, program_level_id, academic_year_id, version)

student_backlogs            -- CBCS arrears
  student_id         UUID FK
  subject_id         UUID FK
  failed_in_semester_result_id UUID FK
  cleared_in_semester_result_id UUID FK NULL
  status             VARCHAR(10)  PENDING | CLEARED

result_publications
  exam_id            UUID FK NULL
  academic_year_id   UUID FK
  program_level_id   UUID FK
  term               VARCHAR(20)
  version            SMALLINT
  approved_by        UUID FK               ≠ marks entrant (rule)
  published_at       TIMESTAMPTZ
  status             VARCHAR(20)  APPROVED | PUBLISHED | WITHDRAWN
  -- parents/students see results ONLY when a PUBLISHED row exists

report_card_templates
  board_id           UUID FK
  name               VARCHAR(100)
  applies_to_levels  UUID[]
  language           VARCHAR(5)   en | kn | both
  layout             JSONB                 header, sections, signature blocks, logo
  is_default         BOOLEAN
```

## 7. Certificates

**Requirements:** TC, Bonafide, Study, Character, Conduct, Migration; numbered; QR verification; template per institution in English/Kannada.

```
certificate_templates
  certificate_type   VARCHAR(20)  TC | BONAFIDE | STUDY | CHARACTER | CONDUCT | MIGRATION | CUSTOM
  name               VARCHAR(100)
  language           VARCHAR(5)
  body_template      TEXT                  HTML with {{placeholders}}
  requires_approval  BOOLEAN

certificates
  student_id         UUID FK
  template_id        UUID FK
  certificate_no     VARCHAR(30)           UQ(tenant_id, certificate_no)
  issue_date         DATE
  purpose            VARCHAR(200)
  verification_code  VARCHAR(20) UQ        public QR verify page
  file_id            UUID FK               generated PDF
  approval_request_id UUID FK NULL
  issued_by          UUID FK
  status             VARCHAR(20)  REQUESTED | APPROVED | ISSUED | CANCELLED
```

## 8. Promotion / year-end rollover

**Requirements:** move students to the next class/semester based on results. Dry run first, exceptions list (detained/failed), then commit. History kept.

```
promotion_batches
  from_academic_year_id, to_academic_year_id  UUID FK
  program_level_id   UUID FK               from level
  status             VARCHAR(20)  DRAFT | REVIEWED | COMMITTED
  committed_by, committed_at

promotion_items
  batch_id           UUID FK
  student_id         UUID FK
  from_section_id    UUID FK
  to_section_id      UUID FK NULL
  decision           VARCHAR(20)  PROMOTE | DETAIN | PASS_OUT | LEAVE
  reason             VARCHAR(200)
  UQ(batch_id, student_id)
  -- commit: old enrolment → PROMOTED/DETAINED, new ACTIVE enrolment created; fees assigned for new year
```

---

**B2 table count: 33** (timetable 4 · homework 2 · diary 1 · syllabus 4 · LMS 3 · exams 15 · certificates 2 · promotion 2).
