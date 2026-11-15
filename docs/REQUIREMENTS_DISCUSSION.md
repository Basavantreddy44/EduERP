# Requirements Discussion: Finalisation Tracker

Goal: agree on the **complete scope** of the School/College ERP before development starts. Every department, administration, students, teachers, hostel, bus, news feed and meetings should be connected in one system.

Status legend: ✅ Agreed · ❓ Open question · ➕ New (added in discussion)

---

## 1. Big-picture decisions

| # | Question | Answer | Status |
|---|---|---|---|
| Q1 | Who uses it? Our own institution(s) only, or sold to many institutions (SaaS)? | **SaaS: sold to many schools/colleges**, each with separate data and login | ✅ |
| Q2 | Institution types in version 1: School / College / Both? | **Both school & college from v1** | ✅ |
| Q3 | How many campuses / students roughly (first customer)? | **Large: 5k–20k+ students per institution, many campuses**. Design for performance from day 1 | ✅ |
| Q4 | Apps: web only, or web + Android/iOS mobile apps? | **Web first, mobile-friendly (installable PWA)**. Native apps in a later phase | ✅ |
| Q5 | Languages: English only, or English + regional (Kannada / Telugu / Hindi…)? | **English + Kannada** (UI + notifications); built so more languages can be added | ✅ |
| Q6 | Board/university: CBSE / ICSE / State board / University (which)? | **CBSE, Karnataka State Board (SSLC), Karnataka PU (II PUC streams), University UG/PG (CBCS: semester, credits, SGPA/CGPA)** | ✅ |
| Q7 | Online fee payment needed in v1? Which gateway (Razorpay / PayU / other)? | **Yes, online payment (UPI/cards) in v1.** Gateway still to choose **Gateway: Razorpay** (behind an adapter so others can be added) | ✅ |
| Q8 | SMS / WhatsApp / Email notifications needed in v1? | **In-app + push, SMS, WhatsApp** (email as well, for staff) | ✅ |

## 2. User roles (who logs in)

| Role | Main work | Confirm |
|---|---|---|
| Super Admin (software owner) | Create institutions, plans | ❓ |
| Management / Trustee / Chairman | View everything, approvals | ❓ |
| Principal / Director / Dean | Academic + admin approvals | ❓ |
| HOD | Department staff, timetable, results | ❓ |
| Office Admin / Front Office | Enquiries, visitors, certificates | ❓ |
| Accountant / Cashier | Fees, expenses, accounts | ❓ |
| Teacher / Lecturer / Class Teacher | Attendance, marks, homework, diary | ❓ |
| Exam Cell | Exams, results | ❓ |
| HR / Payroll | Staff, leave, salary | ❓ |
| Librarian | Books | ❓ |
| Hostel Warden | Rooms, outpass, hostel attendance | ❓ |
| Transport Manager / Driver / Conductor | Buses, routes, trips | ❓ |
| Store Keeper | Inventory | ❓ |
| Parent | Child info, fees, notices, bus | ❓ |
| Student | Timetable, homework, results | ❓ |
| ➕ Security / Gate staff | Visitor entry, gate pass, student exit verification | ✅ |
| ➕ Nurse / Medical staff | Health & infirmary records | ✅ |
| ➕ Counsellor | Discipline & counselling notes (restricted) | ✅ |
| ➕ Mess / Canteen manager | Mess menu, mess attendance, stock usage | ✅ |
| ➕ Sports / PE coordinator | Sports events, teams, achievements | ✅ |
| ➕ Placement officer | College placements: companies, drives, offers | ✅ |
| ➕ Lab assistant | Lab equipment, practical batches | ✅ |
| | Role list closed. Institutions can also create custom roles | ✅ |

## 3. Module checklist (scope)

| # | Module | Basic features | Status |
|---|---|---|---|
| 1 | Institution & Campus setup | Institution profile, campuses, departments, academic year, holidays | ✅ |
| 2 | Users, Roles & Permissions | Login, roles, campus-wise access | ✅ |
| 3 | Admissions | Enquiry → application → approval → student | ✅ |
| 4 | Student management | Profile, parents, documents, promotion, TC, alumni | ✅ |
| 5 | Academics | Classes/courses, sections, subjects, teacher mapping | ✅ |
| 6 | Timetable | Weekly timetable, substitution | ✅ |
| 7 | Attendance | Student + staff, leave | ✅ |
| 8 | Homework / Assignments / Class diary | **Homework & online submission, class diary, lesson plans & syllabus tracking, report-card designer (board formats + college marksheets)** | ✅ |
| 9 | Exams & Results | Exams, marks, grades, report cards, certificates | ✅ |
| 10 | Fees | Fee structure, collection, receipts, dues, concessions | ✅ |
| 11 | Accounts | **Full double-entry accounting (replaces Tally)**: chart of accounts, journals, ledgers, expenses, vendors, bank, P&L, balance sheet, GST/TDS configuration | ✅ |
| 12 | HR & Payroll | Staff, leave, salary, payslips | ✅ |
| 13 | Hostel | **Rooms/beds & allotment, mess management (menu, plans, fees, mess attendance), hostel roll-call with parent alerts, outpass (parent + warden approval), visitors.** Plus: **maintenance complaints, room inventory & damage charges, leave/home-going register with parent-pickup verification, caution deposit & refund, hostel fee instalments** | ✅ |
| 14 | Transport (Bus) | **Basic for v1**: buses, drivers, routes, stops, student assignment, transport fees, document expiry alerts. Live GPS and bus attendance come later | ✅ |
| 15 | Library | Books, issue/return, fines | ✅ |
| 16 | Inventory / Store / Purchase | Items, purchase, stock | ✅ |
| 17 | Communication | Announcements, notifications, SMS/WhatsApp/email | ✅ |
| 18 | ➕ **News Feed** | **Social-style**: posts with photos/videos, likes & comments, admin moderation | ✅ |
| 19 | ➕ **Meetings** | **Parent-Teacher Meetings (PTM)**: teacher slots, parent booking, reminders, attendance. Staff/committee meetings, minutes and online links **not selected for v1** | ✅ |
| 20 | ➕ **Events & Calendar** | School events, exam calendar, holidays, event photos linked to news feed | ✅ |
| 21 | ➕ **Department requests** | Requests between departments (store, maintenance, IT) with approval & status tracking | ✅ |
| 22 | ➕ **Front office** | Visitor log, gate pass, call log, postal register | ✅ |
| 23 | ➕ **Complaints / Grievance** | Parent/student/staff complaints, assignment, SLA, closure | ✅ |
| 24 | ➕ **Health / Infirmary** | Medical visits, checkups, allergies, vaccinations (restricted access) | ✅ |
| 25 | ➕ **Discipline & behaviour** | Incidents, warnings, parent notification | ✅ |
| 26 | ➕ **Study material / LMS** | Notes, videos, links per subject; online class links | ✅ |
| 19b | ➕ **Staff meetings & minutes** | Staff/department/committee meetings: agenda, invite, RSVP, attendance, minutes, action items (now **added** alongside PTM) | ✅ |
| 30 | ➕ Sports & activities | Sports/clubs, teams, events, achievements (linked to news feed) | ✅ (light) |
| 31 | ➕ Placements (college) | Companies, drives, eligibility, student applications, offers | ✅ (light) |
| 32 | ➕ Labs | Lab equipment register, practical batches, breakage | ✅ (light) |
| 27 | Documents & Certificates | Uploads, certificate templates, QR verify | ✅ |
| 28 | Reports & Dashboards | Role-wise dashboards, reports, exports | ✅ |
| 29 | Audit & Security | Audit log, data privacy | ✅ |

## 4. Module discussion questions

### News Feed ➕
- Who can post: admin only / teachers too / students and parents?
- Audience: whole institution, campus, class, department?
- Content: text, photos, videos, PDFs, event posts?
- Likes / comments / reactions? Moderation (approve before publish)?
- Is it separate from announcements? (Suggested: **Announcements** = official, must-read. **News Feed** = activities, photos, achievements.)

### Meetings ➕
- Types: Parent–Teacher Meeting (slot booking) · Staff meeting · Department meeting · Management/committee meeting · Student counselling?
- Features: schedule, invite, RSVP, agenda, attendance, **minutes (MoM)**, action items with follow-up, reminders.
- Online meetings: just paste a Zoom/Google Meet link, or integrate them?
- Room booking for meetings?

### Transport (Bus)
- Live GPS tracking for parents in v1, or later?
- GPS from a device in the bus, or from the driver's mobile app?
- Bus attendance (student boarded/dropped) with parent alert?

### Hostel
- Mess management (menu, mess fee, mess attendance)?
- Hostel night attendance?
- Visitor and outpass approval by parent as well?

### Departments connect ➕
- Should departments raise requests to each other (e.g. Academics → Store for items, Hostel → Maintenance)?
- Approval chain and status tracking needed?

## 5. Decisions log (filled during discussion)

| Date | Decision |
|---|---|
| 2026-11-13 | Q1 SaaS for many institutions · Q2 school + college in v1 · News feed = social-style with moderation · Meetings v1 = PTM only |
| 2026-11-13 | Web-first PWA (native apps later) · Basic bus management (no GPS in v1) · Add events/calendar, department requests, front office, complaints · Channels: in-app, push, SMS, WhatsApp · Online fee payment in v1 · User asked to "consider enhancements" → round 3 |
| 2026-11-13 | Added health, discipline, LMS, staff meetings & minutes · Teaching: homework, diary, lesson plans, report-card designer · Hostel: all 4 features + "other" (to clarify) · Languages: English + Kannada |
| 2026-11-13 | Hostel extras: maintenance, room inventory/damages, home-going register, deposit · Extra roles: security, nurse, counsellor, mess manager (+ "other" pending) · Scale: large 5k–20k+ · Full double-entry accounting |
| 2026-11-13 | Boards: CBSE, KA State, KA PU, University CBCS · Razorpay · Extra roles: sports, placement, lab assistant (implies light modules 30–32) · **First release = Students + Fees + Attendance** |
| 2026-11-13 | **Changed: no partial releases.** Release to clients only after all modules are complete. Internal build order B1–B7 kept |

---

## 6. Agreed v1 product scope (summary)

**Product:** SaaS ERP sold to many schools and colleges. School + PU + UG/PG supported. Built for large institutions (5k–20k+ students, multi-campus). Web-first, mobile-friendly PWA. English + Kannada. Notifications by in-app, push, SMS, WhatsApp and email. Razorpay online payments. Full double-entry accounting.

**Modules (32):** Setup · Users/roles · Admissions · Students · Academics · Timetable · Attendance · Homework/diary/lesson plans · Exams & report cards · Fees · Accounts · HR & payroll · Hostel (incl. mess, roll-call, outpass, home-going, inventory, deposits) · Transport (basic) · Library · Inventory/purchase · Communication · News feed · Meetings (PTM + staff/committee with minutes) · Events & calendar · Department requests · Front office · Complaints · Health · Discipline · LMS/study material · Sports · Placements · Labs · Documents & certificates · Reports/dashboards · Audit & security.

**Later (not v1):** native Android/iOS apps, live GPS bus tracking, bus boarding attendance, biometric/RFID devices, AI analytics.

## 7. Release approach: ✅ DECIDED (2026-11-13)

**Single release.** The product goes to clients only after **all modules are complete and tested**. There are no partial releases to clients.

Development is still done **step by step internally** (build order below), because each module depends on the earlier ones. After each build step, that step is tested and demoed internally.

**Recommended safeguards for a single big release:**
- Internal demo and test after every build step, run with real-looking sample data (forms, fee structures and report cards from a target institution).
- Before launch: a full end-to-end test with one friendly institution as a **private pilot** (not a release), then fixes, then launch.
- Features stay stable during the final testing period. New ideas go to a "version 2" list.

### Build order (internal development steps)

| Step | Modules | Builds on |
|---|---|---|
| **B1: Core** | Platform & SaaS setup, users/roles, academic setup, admissions, students & parents, attendance (student + staff), leave, fees + Razorpay + receipts, basic accounts posting, communication (in-app/SMS/WhatsApp/push), parent/student PWA, dashboards | Office, accounts, teachers, parents |
| B2: Academics | Timetable, homework/diary/lesson plans, LMS, exams & report cards (CBSE/State/PU/CBCS), certificates, promotion | Teachers, exam cell, students |
| B3: Engagement | News feed, events & calendar, meetings (PTM + staff + minutes), complaints, front office, department requests | Everyone |
| B4: Finance & people | Full accounting (vendors, expenses, bank, GST/TDS, statements), HR & payroll | Accounts, HR |
| B5: Campus life | Hostel (all features), mess, transport (basic), library, health, discipline | Wardens, transport, librarian, nurse, counsellor |
| B6: Operations | Inventory/purchase, labs, sports, placements, advanced reports | Store, labs, placement, sports |
| **B7: Final testing** | Full end-to-end testing, security testing, performance test (20k students), private pilot, data migration tools, training material | All |
| **🚀 LAUNCH** | **All 32 modules released to clients together** | |
| Version 2 | Native apps, live GPS, devices, AI | |

## 8. Still open (minor, can close during development)
- SaaS plans and pricing (which modules in which plan).
- SMS / WhatsApp provider (for example MSG91, Gupshup). DLT registration is the institution's or ours.
- Hosting: AWS Mumbai recommended (data stays in India).
- First pilot customer name, and sample data (forms, fee structures, report-card formats).
