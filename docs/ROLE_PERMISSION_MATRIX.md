# Role & Permission Matrix

Model: **RBAC for job functions + ABAC for context** [DOC §3]. Permissions are data (seeded catalogue). Roles are tenant-editable, created from **role templates**. UI menus and buttons are driven by `GET /me/permissions`, never by hard-coded role names.

## 1. Permission code format

`<module>.<resource>.<action>`, for example `fees.invoice.create`, `exam.result.publish`, `accounts.journal.post`. Actions: `view, create, update, archive, submit, verify, approve, post, publish, reverse, export, manage` plus domain-specific actions (`collect`, `disburse`, `allot`, `issue`). Sensitive-data permissions are separate: `student.medical.view`, `student.custody.view`, `employee.bank.view`, `sensitive_data.unmask`.

## 2. Scope (ABAC) dimensions

Each role assignment carries a scope: **TENANT | LEGAL_ENTITY | CAMPUS | DEPARTMENT | STUDENT_GROUP | SELF | RELATIONSHIP (linked children) | ROUTE | HOSTEL | LIBRARY_BRANCH**, plus attribute conditions (academic year, record sensitivity, amount threshold). Evaluation is `permission ∈ role(s) AND resource within assignment scope AND policy conditions (e.g. not own request for approval)`.

## 3. Role catalogue

DOC = from §3. ENH = added (defect D-06 / gap G-03).

| Code | Role | Source | Default scope |
|---|---|---|---|
| PLATFORM_ADMIN | SaaS Super Admin | DOC | Platform. **No tenant business data by default** |
| PLATFORM_SUPPORT | Platform Support | ENH | Platform. Tenant data only via a time-boxed grant |
| TENANT_OWNER | Institution Owner / Trustee | DOC | Tenant |
| TENANT_ADMIN | Tenant IT/System Admin | ENH | Tenant (config/users, not finance approvals) |
| PRINCIPAL | Principal / Director / Dean | DOC | Campus(es) |
| HOD | Department Head | DOC | Department |
| ADMISSION_OFFICER | Admission Officer | DOC | Campus + admission cycle |
| FRONT_OFFICE | Front office / reception | ENH | Campus |
| CLASS_TEACHER | Class Teacher / Mentor | ENH | Student group |
| TEACHER | Teacher / Lecturer | DOC | Assigned offerings/groups |
| EXAM_CONTROLLER | Controller of Examinations / Exam Cell | ENH | Campus / tenant |
| ACCOUNTANT | Accountant / Finance Officer | DOC | Legal entity / campus |
| CASHIER | Fee collection cashier | ENH | Campus counter |
| FINANCE_APPROVER | Finance Controller | ENH | Legal entity |
| HR_MANAGER | HR Manager | DOC | Tenant / campus |
| PAYROLL_OFFICER | Payroll Officer | ENH | Legal entity |
| LIBRARIAN | Librarian | DOC | Library branch |
| WARDEN | Hostel Warden | DOC | Hostel/building |
| TRANSPORT_MANAGER | Transport Manager | DOC | Campus fleet |
| DRIVER | Driver | DOC | Assigned trips |
| STORE_OFFICER | Store / Procurement Officer | ENH | Warehouse / campus |
| PARENT | Parent / Guardian | DOC | Verified linked students, per-link flags |
| STUDENT | Student | DOC | Self |
| APPLICANT | Applicant (pre-admission) | ENH | Own applications |
| AUDITOR | Auditor | DOC | Granted entity + period, read-only |
| DPO | Data Protection / Compliance Officer | ENH | Tenant (compliance module) |
| EMPLOYEE_SELF | Staff self-service (base role for all staff) | DOC §13 | Self |

## 4. Matrix (permission groups × roles)

Legend: **M** manage (CRUD + config) · **C** create/operate · **V** view · **A** approve · **P** post/publish/disburse · **S** self/own only · **L** linked children only · – none. Final per-permission rows are produced in each module spec pack.

| Group | P.ADMIN | T.OWNER | T.ADMIN | PRINC | HOD | ADM.OFF | TEACH | CL.TEACH | EXAM.C | ACCT | CASH | FIN.APPR | HR | PAYROLL | LIB | WARDEN | TRANSP | DRIVER | STORE | PARENT | STUDENT | AUDITOR | DPO |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tenants/plans | M | V | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| Org & settings | – | M | M | V | V | – | – | – | – | V | – | V | V | – | – | – | – | – | – | – | – | V | V |
| Users & roles | – | A | M | V | – | – | – | – | – | – | – | – | V | – | – | – | – | – | – | – | – | V | V |
| Academic config | – | V | M | A | C | – | V | V | V | – | – | – | – | – | – | – | – | – | – | – | – | V | – |
| Admissions | – | V | – | A | V | C | – | – | – | V | – | – | – | – | – | – | – | – | – | – | – | V | – |
| Students (core) | – | V | V | V | V | C | V* | C* | V | V | V | – | – | – | V | V* | V* | – | – | L | S | V | V |
| Medical/custody data | – | – | – | V | – | – | – | V* | – | – | – | – | – | – | – | V* | – | – | – | L | – | – | V |
| Timetable | – | V | – | A | C | – | V | V | – | – | – | – | V | – | – | – | – | – | – | L | S | – | – |
| Attendance (student) | – | V | – | A | V | – | C | C/A | V | – | – | – | – | – | – | C* | C* | C* | – | L | S | V | – |
| Assignments | – | – | – | V | V | – | C | C | – | – | – | – | – | – | – | – | – | – | – | L | S | – | – |
| Marks entry/verify | – | – | – | V | A | – | C | V | M | – | – | – | – | – | – | – | – | – | – | – | – | V | – |
| Result publish | – | V | – | A | – | – | – | – | P | – | – | – | – | – | – | – | – | – | – | L | S | V | – |
| Fee config | – | V | – | V | – | – | – | – | – | M | – | A | – | – | – | – | – | – | – | – | – | V | – |
| Fee collection | – | V | – | V | – | V | – | – | – | C | C | V | – | – | – | – | – | – | – | L (pay) | S (pay) | V | – |
| Concession/refund | – | V | – | A | – | – | – | – | – | C | – | A | – | – | – | – | – | – | – | – | – | V | – |
| Journals/GL | – | V | – | – | – | – | – | – | – | C | – | A/P | – | – | – | – | – | – | – | – | – | V | – |
| Period close | – | – | – | – | – | – | – | – | – | C | – | P | – | – | – | – | – | – | – | – | – | V | – |
| HR records | – | V | – | V | V | – | S | S | S | S | S | S | M | V | S | S | S | S | S | – | – | V | V |
| Payroll | – | V | – | – | – | – | S | S | S | S | S | A | C | C | S | S | S | S | S | – | – | V | – |
| Payroll disburse | – | – | – | – | – | – | – | – | – | – | – | P | – | – | – | – | – | – | – | – | – | V | – |
| Hostel | – | V | – | V | – | – | – | – | – | V | – | – | – | – | – | M | – | – | – | L | S | V | – |
| Transport | – | V | – | V | – | – | – | – | – | V | – | – | – | – | – | – | M | C* | – | L | S | V | – |
| Library | – | V | – | V | – | – | S | S | – | – | – | – | – | – | M | – | – | – | – | L | S | V | – |
| Procurement/inventory | – | V | – | A | C | – | – | – | – | V | – | A | – | – | – | – | – | – | M | – | – | V | – |
| Communication | – | C | C | C | C | C | C* | C* | C | C | – | – | C | – | – | C* | C* | – | – | – | – | – | – |
| Audit logs | – | V | V | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | V | V |
| Compliance/DSR | – | V | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | S | S | V | M |
| Exports | – | C | C | C | C | C | – | – | C | C | – | C | C | C | C | – | C | – | C | – | – | C | C |

\* within the narrower assignment scope (own groups / hostel / route).

## 5. Segregation-of-duties rules (enforced by ApprovalService) [DOC §3]

| Rule | Enforcement |
|---|---|
| SoD-1 | Requester ≠ approver for concessions, refunds, write-offs, journal posting above threshold, payroll approval, PO approval, attendance/marks corrections |
| SoD-2 | Payroll preparer (`payroll.calculate`) ≠ disburser (`payroll.disburse`) |
| SoD-3 | Marks entrant ≠ result approver |
| SoD-4 | Cashier cannot approve their own session variance |
| SoD-5 | Bank reconciliation preparer ≠ reconciliation approver (configurable) |
| SoD-6 | Role assignment of finance/payroll roles requires TENANT_OWNER approval |
| Override | Emergency override needs `sod.override` + reason + MFA step-up, and creates a high-severity audit event |
