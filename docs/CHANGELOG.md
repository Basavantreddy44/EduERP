# Changelog

## [Unreleased] — 2026-11-24 (Phase 20: Editions — Standard and Residential)
### Added
- **Editions.** Every institution has an edition, chosen by the platform when it is created: **EduERP** (standard, every module on) or **EduERP Residential** (government residential schools such as Morarji Desai / KREIS — starts without Admissions, Fees, Transport and Placements, and with the extra roles Principal, Warden, Kitchen in-charge and Head office officer). The platform console shows and filters institutions by edition and can change an institution's edition after a preview of what changes; data and roles are never deleted, platform add-ons stay, and with a plan the plan keeps deciding the modules.
- **Residential wording and menu.** In the Residential edition the screens say "School / Schools" for campus and "Head office (all schools)" for the whole institution, in English and Kannada; hostel, student care and attendance come first in the menu.
- **Institution profile** (Setup → Institution profile): name in English and Kannada, contact details, address and a logo (PNG / JPEG / WebP, up to 1 MB). The logo shows in the top bar, in the institution chooser, on the institution's own sign-in link (`/login?i=<address>`) and on fee receipts, report cards, certificates, transfer certificates, payslips, purchase orders and the online payment page.
- A second demo institution in the Residential edition: two Morarji Desai residential schools (Hunsur, Mysuru; Kollegal, Chamarajanagar), head office, a principal per school, a warden and a kitchen in-charge, 30 students in the hostels, meals and a welfare hand-out.
### Changed
- Existing institutions are the Standard edition; their screens, modules and roles are unchanged. Signing in from an institution's own link opens that institution when the person belongs to several. Two-column and four-column form rows no longer push a long value past the edge of the screen.

## [Unreleased] — 2026-11-23 (Improvement round: government residential school pack — SATS / UDISE+, welfare, diet, schools overview)
### Added
- **SATS & UDISE+** (Students → SATS & UDISE+): a "Government data" tab on every student (SATS student ID, UDISE+ PEN, ration card, EWS, minority group, child with special needs, medium of instruction, distance from home, previous school) showing what each export still misses; readiness by school and a list of students with missing fields; SATS and UDISE+ exports to Excel / CSV whose columns the institution can rename, reorder, add or remove to match each year's portal template, and reset to the standard.
- **Welfare items & allowances** (Students → Welfare items): schemes per academic year (uniforms, kits, notebooks from the store, or cash allowances) for chosen classes and boys / girls; hand out to a class at once — nobody gets more than the entitlement, stock leaves the store as a welfare movement, cash needs the payment reference; who received what on the student's page and in a report.
- **Diet & meals** (Hostel → Diet & meals): the diet scale (quantity of each food item per child per day, set once for every campus), the daily meal register by class (filled in from the hostel roll call), and a diet report comparing what the scale allows for the children fed with what the stores issued, flagging items outside an allowed difference.
- **Government service details** on the staff profile (employment type, KGID, HRMS ID, PRAN / GPF, pay scale, government service date) and the DDO code of each school; report "Staff for HRMS".
- **Schools overview** (Overview → Schools overview): every school (campus) side by side, grouped by district with totals — students, staff, today's attendance and hostel roll call, children fed yesterday, diet items off this month, welfare handed out, SATS / UDISE+ readiness and the latest pass percentage. A principal sees only their own school.
- Reports: SATS student data, UDISE+ student data, Staff for HRMS, Welfare by student.
### Changed
- The item ledger knows a new movement, "Welfare". Nothing else in the existing modules changed.

## [Unreleased] — 2026-11-23 (Improvement round: access control — roles master and user access)
### Added
- **Roles & rights** (Users → Roles & rights): built-in roles are fixed templates (view and copy); the institution's own roles are created from scratch or from a copy, renamed, given rights and deleted when nobody holds them. Every right is shown in plain English and Kannada, grouped by module with an "all rights of this module" box and a search; only the modules the institution has are offered; who holds each role is listed.
- **One page per person** (Users → a name): their roles and the campus each applies to (all campuses, or one campus — so each campus can have its own HOD or principal), give a role, take one away, send a password-reset link or the invitation again, the staff / student / parent record the login belongs to, and everything they can do grouped by module with the campuses where each right works.
- Users list: filter by role, "Manage access" on each row. New right "Create and edit the institution's own roles" (Institution Admin has it).
### Security
- Nobody can give a role — or invite someone into one, including by bulk import — that carries rights they do not hold themselves, or for a campus they do not manage. The institution always keeps at least one Institution Admin for all campuses; nobody can remove their own admin access. Changes apply on the person's next click and are written to the audit log.

## [Unreleased] — 2026-11-21 (Phase 19 Placements, and Reports & exports)
### Added
- Placements: companies (active / blacklisted with a reason); a placement profile per student with CGPA or percentage and backlogs entered and verified by the placement cell (until university results come in), skills, preferred locations and resume.
- Placement drives with eligibility (programmes, passing year, minimum score, most backlogs, already-placed students), last date and rounds; eligible students with a login are told when a drive opens.
- Students apply from the student app (parents can follow but not apply); the officer can enrol eligible students; each application keeps a snapshot of the score it was made with.
- Applications move round by round; offers with CTC, dates and offer letter; accepting marks the student placed; a second accepted full-time offer is refused unless the drive allows placed students.
- Placement statistics per batch: placed %, highest / average / median CTC, by programme and by company.
- Reports: nine standard reports (students, fee dues, fee collection, attendance summary, staff, library overdue, stock value, achievements, placement offers), each read with its module's own right and campus; saved filters, private or shared; background exports to Excel and CSV kept 7 days with a download log; weekly / monthly email of a saved report.
- Built-in role: Placement officer. The worker now builds exports and sends scheduled reports.
### Fixed
- Phone layout: on some pages (students, admissions, leave, fee set-up, accounts payments / vouchers / vendors / set-up, HR leave balances and set-up) the page loaded wider than the phone and the phone zoomed out. The main content area no longer widens the page, and long tab rows scroll inside themselves. All 74 staff pages and every tab of the parent / student app now measure exactly the phone's width. The earlier phone checks compared the page with itself and missed this; they now compare with the phone's width.

## [Unreleased] — 2026-11-20 (Phase 18 Labs, and Sports & activities)
### Added
- Labs with their in-charge, assistant, seats and own store; an equipment register with asset tags (unique per institution), condition and calibration dates, and a calibration due list.
- Practical sessions booked per lab, class, batch and teacher; a lab is never booked twice at the same time; sessions marked done (with students present) or cancelled.
- Lab breakages charged to the student's fees under Fines — after approval where a rule exists — or waived with a reason; broken equipment taken off the count.
- Sports, clubs and houses with a coordinator; members per year with team and role (captain, vice-captain, secretary).
- Competitions (school level to international) with entries by category and results; optional calendar event.
- Achievements for students and staff: from a result or recorded by a teacher, verified by a coordinator, then shown on the student profile and in the parent app, parents told, and optionally posted to the news feed.
- Activities report: participation and medals by activity and level, with CSV download.
- "Activities" tab on the student profile and in the parent app.
- Built-in roles: Lab assistant, Sports & activities coordinator; teachers can book practicals, report breakages and record achievements.

## [Unreleased] — 2026-11-20 (Phase 17 Inventory & purchase)
### Added
- Items, categories and stores (with a store keeper), opening stock, and stock by store at the weighted-average rate; every movement in an item ledger.
- Purchase requests from departments (approval where a rule exists), vendor quotations side by side with the lowest marked, and the chosen quotation with its reason.
- Purchase orders (from a quotation or direct, approved by amount where a rule exists), printable for the vendor.
- Goods receipts with accepted and rejected quantities (up to 5% over the order); only accepted goods enter stock.
- Vendor bill made from a goods receipt (3-way match: never more than accepted and not yet billed, at the order rate), posted in Accounts as before.
- Issues to departments or staff, transfers between stores, stock counts adjusted after approval, a daily low-stock notice to store keepers.
- Store reports: consumption by department and the purchase register, with CSV download.
- Built-in role: Store keeper.
- pgAdmin for developers (`docker compose --profile tools up -d pgadmin`, http://localhost:5050).
### Fixed
- The approvals page showed codes instead of names for eleven approval types added since Phase 12; every type must now have a name or the build fails.

## [Unreleased] — 2026-11-20 (Phase 16 Campus life II)
### Added
- Library: catalogue with accession numbers and barcodes, Excel import of the register, issue and return by scan, renewals, reservations held for the first in line, late fines and lost books billed to fees, overdue reminders, stock verification, My library and the parent app's Library tab.
- Health & infirmary: student health records with allergy warnings, infirmary visits (parents told when a child is sent home or referred), check-ups and vaccinations with a due list.
- Discipline: incident types, incidents reported by teachers, review, actions (warning, parent meeting, suspension, fine billed to fees, counselling) and closing; class teachers see their class.
- Counselling sessions with encrypted notes only their author can read.
- Built-in roles: Librarian, School nurse, Counsellor.

## [Unreleased] — 2026-11-19 (Phase 15 Payroll)
### Added
- Salary components and structures, staff salaries with revisions and a live monthly breakdown.
- Statutory rules, pre-filled and marked "please check": PF, ESI, Karnataka professional tax and new-regime income tax (TDS spread over the year), with a fixed-TDS option and tax openings for salary paid earlier in the year.
- Monthly payroll runs per campus: loss of pay from attendance and leave, one-off lines, approval by another person, one journal per run, bank transfer file, payment and payslip release.
- Payslips (print / PDF) and "My payslips" for every staff member.
- Salary advances and loans recovered from salary.
- Statements: payroll register, PF with the EPFO ECR file, ESI, professional tax, TDS on salary.
- Final settlement worksheet on staff exits.

## [Unreleased] — 2026-11-19 (Phase 14 HR)
### Added
- Full staff profiles: personal, statutory (PAN encrypted, Aadhaar last 4 only, UAN, PF, ESI) and salary bank details, qualifications and experience; "My profile" for every staff member.
- Designations (existing job titles carried over automatically).
- Shifts, with late and half-day worked out from check-in times on staff attendance.
- Leave balances with opening balances, carry-forward (up to a limit), encashment and corrections; the leave form uses the same balance.
- Staff exits with handover, no-dues clearance by section and closing (login removed, settlement kept for payroll).
- Built-in role: HR officer.

## [Unreleased] — 2026-11-19 (Phase 13 Accounts)
### Added
- Full accounting: chart of accounts editor, cost centres, bank accounts, opening balances, month lock and year close.
- GST and TDS rates (pre-filled, to be checked by the accountant).
- Vendors and bills with GST (CGST + SGST or IGST) and TDS worked out; approval and posting.
- Vendor payments (part, full, advance), advance adjustment, expense / contra / journal vouchers.
- Bank statement import and reconciliation with automatic matching and a reconciliation statement.
- Reports: day book, cash and bank books, ledger, trial balance, income & expenditure, balance sheet, receipts & payments, GST and TDS registers, with Excel download.
- Field-level encryption for bank account numbers and PAN (key in the server environment).
- Built-in roles for every institution: Teacher, Head of Department, Exam cell, Front desk, Accountant.
### Changed
- Fee receipts and other postings dated in a locked month or closed year are refused with a clear message.

## [Unreleased] — 2026-11-18 (Phase 12 Engagement II)
### Added
- Staff meetings and committees: schedule, invite, answer, attendance, minutes (draft, shared, approved and then locked) and action items with owners and due dates.
- Complaints from parents (in the app) and staff: categories with a person responsible and a time to resolve, replies and staff-only notes, sensitive complaints for permitted staff only, rating on closing, reopening, and hourly escalation of overdue complaints.
- Front office: visitor log (only the last 4 characters of an ID kept), gate passes (a guardian on record at once, anyone else after approval), call log with follow-ups, postal register with hand-over.
- Department requests between departments: request types, approval when needed, assignment within the handling department, updates, completion and closing by the requester.
### Changed
- The "Meetings" module switch now covers parent-teacher meetings and staff meetings.

## [Unreleased] — 2026-11-18 (Phase 11 Engagement I)
### Added
- School news feed: posts for the whole school, a class or a section, with photos and PDFs.
- Teachers' posts can be set to need approval.
- Moderators can pin, hide and act on reports.
- Parents see only the news meant for their children, and can react, comment and report.
- Events with registration, places, parent consent and fees, which are billed once.
- Event attendance, marked after the event.
- A calendar of events, holidays, exams and parent-teacher meetings (month view, and a list on phones).
- Parent-teacher meetings: a meeting day for chosen classes, with times for each teacher.
- Parents book one time with each of their child's teachers in the app; a time can never be booked twice.
- Teachers record each meeting with notes, and parents can leave feedback.

## [Unreleased] — 2026-11-18 (Phase 10 Academics II)
### Added
- Syllabus units and topics for each class and subject.
- Lesson plans by the subject teacher: taught or postponed.
- Syllabus coverage for every subject and class.
- Study material: notes, links, videos and PDF worksheets for a class.
- Parents and students open study material in the app; teachers see how many have opened each item.
- Bonafide, study, character and conduct certificates from English or Kannada templates.
- Certificates are numbered without gaps, carry a QR code, and can be checked by anyone on a public page.
- Certificates can be cancelled with a reason, or sent for approval first.

### Changed
- The offline page now tells "no internet" apart from "EduERP is not answering".

## [Unreleased] — 2026-11-18 (Phase 9 Exams & report cards)
### Added
- Grading scales and assessment schemes, with ready-made CBSE, Karnataka State and Karnataka PU patterns you can change.
- Exams and their timetable for each class.
- Mark entry by the subject teacher: absent, malpractice and exempt codes; marks can never be above the maximum.
- Every mark sheet is verified by a second person and then locked. Corrections need a reason and are logged.
- Results calculated exactly by the scheme: weights, rounding and pass rules, with rank, attendance and remarks.
- Co-scholastic grades.
- Publishing by someone who did not enter the marks. Each publication is a new version and older ones are kept.
- Printable report cards (A4) in English and Kannada.
- Parents see published results and the report card in the app.

## [Unreleased] — 2026-11-18 (Phase 8 Academics I)
### Added
- Subjects, each class's syllabus (core subjects, languages, optional subjects) and rooms.
- Class teacher and subject teachers for every class; students' optional subjects.
- Timetable for every class on the bell timings. Publishing refuses clashes — a teacher or a room can never be in two places in the same period — and says exactly where.
- Teachers see their own week and today's lessons.
- Substitutions: only teachers who are free that period (and not on leave) are offered; the substitute is told in the app.
- Homework: teachers give homework to their classes, parents are told, students submit answers in the app, and teachers mark them.
- Class diary: notes to the whole class or to one child's parents, who confirm they have seen them.
- Parent app: the child's timetable one day at a time (with substitutes shown) and a Homework tab with the diary.

## [Unreleased] — 2026-11-18 (Phase 7 Hostel & mess)
### Added
- Hostels with rooms, beds and each room's items. An occupancy picture shows every hostel and room at a glance.
- Allot a bed: boys' and girls' hostels are kept separate, and a bed can never be given twice. The hostel fee for the rest of the year and the caution deposit go onto the bills straight away.
- Check-in and check-out against the room's items. Anything damaged or missing becomes a damage charge once approved, and the deposit to refund is worked out.
- Night roll-call. Parents of absent students are told by app and email.
- Outpasses: the parent approves in the app, then the warden. The student cannot go out without both.
- Home-going register. Anyone collecting a student who is not a guardian on record needs the warden's explicit OK.
- Visitors log and maintenance requests.
- Mess: meal plans, a weekly menu, billing and today's meal counts for the kitchen.
- Parents see their child's room, the warden, recent nights, today's menu, and outpasses to approve.
- SMS / WhatsApp alerts show "Coming soon".

## [Unreleased] — 2026-11-18 (Phase 6 Transport)
### Added
- Buses and vans, each with its papers (RC, insurance, fitness, permit, PUC, road tax). Reminders go out 30, 15 and 7 days before any paper or a driver's licence runs out.
- Drivers, attendants and conductors, chosen from the staff list.
- Routes, each with a bus, a driver and its stops in pickup order, with times and a yearly fee per stop.
- Put a student on a bus from their profile. The bus can never be over-full, and the bus fee for the rest of the year goes onto the student's bills straight away.
- A printable list of students on each route, stop by stop, for the driver.
- Parents see their child's bus, stop, pickup and drop times and the driver's phone in the app. Live bus location shows "Coming soon".

## [Unreleased] — 2026-11-17 (M5.3 Installable app — Parent & student app phase complete)
### Added
- Parents (and staff) can add EduERP to their phone's home screen, where it opens like an app with the school's icon.
- A clear "You are offline" page in English and Kannada when there is no internet. No school data is stored on the phone.
- Bottom tabs on phones for Home, Attendance, Fees and Leave.
- Phone notifications show "Coming soon".

## [Unreleased] — 2026-11-17 (M5.2 Child's day-to-day in the parent app)
### Added
- Parents see each child's attendance as a month calendar with the percentage, what is still to pay, every bill and receipt (printable), and can pay everything due online.
- Parents can apply for their child's leave and withdraw it before it starts. The school's approvers decide as usual.
- Where the school has no online payment set up, the parent app shows "Coming soon".

## [Unreleased] — 2026-11-17 (M5.1 Parent & student logins)
### Added
- The office can give a parent (or an older student) a login from the student's profile. The person gets an email to set their password. One login covers all their children at the school.
- Parents and students sign in to their own simple app showing each child's class.
- Logins can be removed at any time. A child who leaves the school drops out of the parent's app on its own.
- "Coming soon" markers where SMS / WhatsApp will appear once a provider is chosen.

## [Unreleased] — 2026-11-17 (M4.3 Trends — Dashboards phase complete)
### Added
- Home screen charts: fee collection for each of the last 30 days, and student attendance % for each school day of the last 4 weeks. Hover over a day for its details, or open each chart as a table.

## [Unreleased] — 2026-11-17 (M4.1–M4.2 Dashboard)
### Added
- A new home screen showing today at a glance: attendance, staff present, fees collected and outstanding, admission follow-ups, and approvals waiting. Each person sees only what their role allows.
- A "Needs attention" list: classes not marked, staff attendance not saved, follow-ups due, applications to review, overdue fees and approvals. Each item opens the screen where it is done.
- Fees collected this month by payment mode, and this year's admissions by stage.
### Changed
- Staff attendance, enquiries, applications and dues open already filtered when reached from the home screen.

## [Unreleased] — 2026-11-17 (M3.5 Attendance reports — Staff, Attendance & Leave phase complete)
### Added
- Monthly class register (students × days) with each student's attendance %.
- Student attendance % for any period, with the list of students below the minimum (75 % by default, changeable in Settings).
- Staff attendance for the month.
- Every report downloads to Excel with exactly what is on screen.

## [Unreleased] — 2026-11-17 (M3.4 Leave & staff attendance)
### Added
- Leave types for staff (paid / unpaid, days a year) and for students.
- Staff apply for their own leave and see their balance; the office applies for students and other staff. Only working days are counted; overlapping or over-the-limit leave is refused; approval through Approvals when a rule is set.
- Approved leave appears as "Leave" on attendance sheets automatically.
- Staff attendance: mark every staff member for the day with in / out times.

## [Unreleased] — 2026-11-17 (M3.3 Corrections & parent alerts)
### Added
- Correct a submitted attendance mark with a reason; if the institution sets an approval rule, the change waits for the approver.
- A list of all attendance corrections: who asked, why, and who decided.
- Parents of absent students get an email the same day (once per day, to the main contact). Can be switched off in Settings.

## [Unreleased] — 2026-11-17 (M3.2 Attendance)
### Added
- Take attendance on a phone or computer: everyone starts as present; tap absent, late, half day or leave; add a note; save a draft or submit.
- Submitted attendance is locked (changes will go through a correction request).
- "Attendance at a glance": which classes have taken attendance today and how many students are absent.
- Bell timings per campus, and a setting for daily or period-wise attendance and for weekly holidays (e.g. 2nd and 4th Saturdays).
- No attendance can be taken on holidays, weekly holidays or future dates.

## [Unreleased] — 2026-11-16 (M3.1 Staff)
### Added
- Staff list: add, edit, search by name / code / mobile, filter by type and department, import and export with Excel.
- Employee codes are given automatically (EMP-0001…) unless you enter your own.
- Mark staff as on long leave, resigned or relieved (with the last working day).
- Link a staff member to their login (needed for attendance next).

## [Unreleased] — 2026-11-15 (M1.4 Lifecycle — Admissions & Students phase complete)
### Added
- Year-end promotion: pick the years and classes, check who moves where (missing sections, seats, students with dues), mark students who stay back, then confirm. Final-year students pass out; fees for the new year are assigned automatically; past promotions are listed.
- Transfer Certificate: issued only when all fees are paid; numbered and printable; the student is marked transferred and no further fees are billed.

## [Unreleased] — 2026-11-15 (M2.5 Dues & reports — Fees phase complete)
### Added
- Dues list with how long amounts are overdue, filters, export, and email reminders (with a payment link).
- Late fees applied automatically every day from the late-fee rules; waive with a reason.
- Fee reports: daily collection by mode and cashier, collection by fee head, dues by class — each checked against the accounts.
- "No dues" check for a student (used by the Transfer Certificate next).

## [Unreleased] — 2026-11-15 (M2.4 Online payment)
### Added
- Payment links: parents pay online (UPI, cards, net banking) from a secure link — by email or WhatsApp; a receipt only after the payment is confirmed.
- Razorpay connection (test mode until go-live) with verified checkout, webhook and an automatic re-check; a simulated gateway for development.
- Refunds with approval: online refunds go back through the payment gateway.
### Fixed
- The permissions list is returned in a fixed order.

## [Unreleased] — 2026-11-15 (M2.3 Counter collection)
### Added
- Collect fees at the counter: cash, cheque, DD, UPI, card, bank transfer; part payments; printable receipts with the amount in words.
- Cash counter per cashier: open with opening cash, close with counted cash and the difference.
- Cancel a receipt or record a bounced cheque (with an optional bounce charge); the bills become due again.
- Receipts on the student's Fees tab; every receipt recorded in the accounts.

## [Unreleased] — 2026-11-15 (M2.2 Assign & bill)
### Added
- Students get their class's fee plan automatically; fee-group plans per student.
- Billing page: preview and create the bills of an instalment for everyone, safe to repeat.
- Concessions (percent or fixed amount) decided through Approvals; approval also reduces unpaid bills.
- Extra one-off charges; cancelling an unpaid bill.
- Student profile → Fees tab with bills, concessions and balance.
- Double-entry journal: every bill is recorded in the accounts; entries are balanced and can only be reversed.
### Changed
- Student search is faster on large schools.
- "Unpaid"/warning labels and faded table rows have stronger contrast.

## [Unreleased] — 2026-11-15 (M2.1 Fee setup)
### Added
- Fee heads (each recorded in an account), a starter chart of accounts per institution, financial years.
- Fee structures per class and year (optional fee group) with instalments; draft → active → closed; revise and copy to the next year.
- Late-fee rules (once, per day or percent; grace days; maximum).
- "Fee setup" screens with a fee grid and live totals, in English and Kannada.

## [Unreleased] — 2026-11-15 (M1.3 Students & parents)
### Added
- Student list with instant search (name, admission number, parent mobile) and class / section / status filters; fast with 20,000 students.
- Student profile: details, parents (shared between brothers and sisters), class history, status history, documents.
- Edit details, change status (inactive / discontinued / re-join) with permanent history, change section within the class.
- Student import from Excel and export with the same columns.
### Changed
- Admissions enrolment now writes the first status-history entry. Documents list shared between Applications and Students.

## [Unreleased] — 2026-11-15 (M1.2 Admissions)
### Added
- Enquiries with follow-ups and a due/overdue list; applications with duplicate check, documents, decisions and withdrawal; enrolment into a section with free seats (creates the student, admission number and parents). Screens in English and Kannada.
- Student, guardian and enrolment tables (foundation for M1.3).
- Tests AC24–AC27 (18 tests). OpenAPI now 79 paths.

## [Unreleased] — 2026-11-14 (M1.1 Class structure)
### Added
- Boards, programmes with generated classes, sections per academic year (API + "Classes & sections" screen, en/kn).
- Plan for B1 Phase 1 (M1.1–M1.4, AC23–AC28) in IMPLEMENTATION_ROADMAP §2b. Test AC23 (6 tests).

## [Unreleased] — 2026-11-14 (M0.4 Experience — Phase 0 complete)
### Added
- English/Kannada screens with a language switch (sign-in, password pages, account menu); language saved per person (`PATCH /me/preferences`).
- DataTable component (sorting, paging) on Users and Departments.
- Accessibility: skip link, labelled settings fields, menu semantics; tests AC20 (browser + API).
### Changed
- Colour tokens adjusted for WCAG AA contrast (muted text, gold ink, faded rows).

## [Unreleased] — 2026-11-14 (M0.3b Data in/out)
### Added
- Import framework with Departments, Holidays and Users importers; Excel templates with Help sheet; row-level review; error report; one-transaction commit.
- Exports (xlsx/csv) for Campuses, Departments, Holidays, Users.
- Idempotency keys (API interceptor + web create forms).
- "Import data" page and Export buttons. Tests AC18–AC19 (13 tests).
### Changed
- DATABASE_URL now sets `connection_limit=15` (update your .env from .env.example).
- Clearer browser messages when the server is busy or unreachable.

## [Unreleased] — 2026-11-14 (M0.3 Onboarding & SaaS)
### Added
- Academic years, departments, holidays (API + screens).
- Invite and password-reset emails with one-time links; Forgot-password and Set-password pages.
- Plans, subscriptions and per-institution modules (32-module catalogue); module guard; platform Plans page and institution Manage panel.
- Users & access screen (invite, roles, remove access); roles endpoint.
- Design system across the app: shell with icons and slide-in phone menu, dashboard with setup checklist, shared components, toasts.
- Tests AC15–AC17 (11 tests); decisions CD-17, CD-18.
### Fixed
- DB transaction maxWait raised to 10 s (bursts no longer fail); phone-width overflow; sign-in/forgot forms safe before hydration.

## [Unreleased] — 2026-11-14 (M0.2 Platform services)
### Added
- Migration `m02_platform_services` (11 tables, RLS, SoD trigger, partial unique index for open approvals).
- Settings registry, numbering service, transactional outbox, background worker (pg-boss) with retries and dead letter, files with local storage driver, notifications core (in-app + email, en/kn templates, preferences, delivery log), approvals engine.
- `@TenantMember()` access rule; 7 permissions; seed syncs new permissions into existing institutions' system roles and loads default templates.
- Web: notification bell, Approvals page, Settings page.
- Tests for AC9–AC14 (35 new tests); ADR-006; decisions CD-14…CD-16.
### Changed
- `migrate:new` uses `prisma migrate diff` (shadow DB cannot replay hand-written grants).
- Mailpit is a standard local service; `db:seed` also runs `jobs:setup`; CI runs Mailpit.

## [Unreleased] — 2026-11-14 (M0.1 complete)
### Added
- `apps/e2e`: Playwright AC8 end-to-end test (institution picker, campus create, viewer 403).
- OpenAPI 3 document generated from routes + shared Zod schemas + access rules; Swagger UI at `/api/docs` (non-production); `docs/api/openapi.json`; CI checks it is up to date.
- Favicon.
### Changed
- Login page redesigned (navy & gold split layout, feature list with icons, floating labels, show/hide password, Caps Lock warning).

## [Unreleased] — 2026-11-13 (M0.1)
### Added
- Monorepo (pnpm + Turborepo), docker-compose (Postgres 16 + Redis), `.env.example`, git repository.
- `packages/db`: Prisma schema + first migration (11 platform tables) with RLS, composite tenant FKs, CHECKs, append-only audit; seed for permissions and platform admin.
- `packages/shared`: permission catalogue, system roles, Zod schemas.
- `apps/api` (NestJS 11): auth with rotating refresh tokens, tenant context, AccessGuard, campuses, users, audit log, platform tenants, health.
- `apps/web` (Next.js 15): login, institution picker, permission-driven shell, campuses, platform institutions.
- Integration test suites for AC1–AC7; GitHub Actions CI.
- ADR-001…005; decisions CD-06…CD-13.
### Changed
- B1 table doc: users.platform_role, users.locked_until, refresh_tokens.family_id/replaced_by, login_history.identifier, audit_logs.request_id; user_type no longer has PLATFORM.

## [Unreleased] — 2026-11-13
### Added (requirements finalised)
- `docs/REQUIREMENTS_DISCUSSION.md`: agreed v1 scope (32 modules, SaaS, school + PU + CBCS, English + Kannada, Razorpay, full accounting, single launch).
- `docs/BASIC_PHASE_DESIGN.md` rewritten as the architecture + design overview.
- `docs/tables/B1…B6`: complete table structures (237 tables) in build order.

### Added (initial blueprint)
- Initial project blueprint from `School_College_ERP_Complete_Project_Documentation.pdf` v1.0 and the master project prompt: requirements analysis, gap analysis (G-01…G-32), document defects (D-01…D-08), module/submodule breakdown, dependency matrix, workflow catalogue, architecture, database plan, API plan, role/permission matrix, screen inventory, security/privacy assessment, test strategy, roadmap, risk/assumption register, decision log.
- No application code, migrations or source files created (analysis phase).
