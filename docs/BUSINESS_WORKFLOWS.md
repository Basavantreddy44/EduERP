# Business Workflow Catalogue

W-01…W-08 come from **[DOC §5]**. W-09…W-18 are **[ENH]** (gap G-10). Each workflow is implemented as an explicit server-side state machine. Transitions not listed are rejected with `409 INVALID_STATE_TRANSITION`.

## 1. Workflow catalogue

| ID | Workflow | Modules | Trigger → end state | Key controls |
|---|---|---|---|---|
| W-01 | Admission to enrolment [DOC §5.1] | M03, M04, M05, M10, M18 | Enquiry → Enrolled student | Duplicate check, eligibility rules, document verification, committee decision with reason, offer expiry, **transactional** student + enrolment + number creation |
| W-02 | Attendance capture & correction [DOC §5.2] | M06, M08, M17 | Session generated → Published | Valid enrolment, capture window, idempotent device events, correction keeps original evidence |
| W-03 | Examination to result publication [DOC §5.3] | M09, M08, M10 | Exam created → Results published | Eligibility, completeness, moderation log, versioned calculation, approver ≠ entrant, scheduled release |
| W-04 | Fee collection to GL [DOC §5.4] | M10, M11 | Assignment → Reconciled | Signature-verified idempotent webhooks, receipt only on confirmed payment, balanced posting, reconciliation is a separate state |
| W-05 | Payroll [DOC §5.5] | M12, M08, M11 | Inputs frozen → Paid & posted | Preparer ≠ approver, bank-file checksum, secure payslip release |
| W-06 | Hostel allocation [DOC §5.6] | M13, M10 | Application → Checked out | Capacity, configured eligibility rules, reservation expiry, deposit/damages via fees |
| W-07 | Transport & trip operations [DOC §5.7] | M14, M10, M17 | Request → Trip closed | Capacity, vehicle document validity, tracking window, incident escalation |
| W-08 | Procurement to payment [DOC §5.8] | M16, M11 | PR → Vendor paid | Budget check/commitment, thresholds, quote comparison, 3-way match, accepted qty only |
| W-09 | Academic-year rollover & promotion | M05, M04, M10, M06 | Year N closing → Year N+1 active | Dry run, promotion rules (pass/detain/graduate), exceptions list, re-runnable, history preserved |
| W-10 | Student transfer (campus/section/programme) | M04, M05, M10, M13, M14 | Request → Effective | Effective-dated, fees prorated/adjusted, hostel/transport closed or moved, no double active enrolment |
| W-11 | Withdrawal & Transfer Certificate | M04, M10, M15, M13, M18 | Request → TC issued | No-dues clearance (fees, library, hostel), refund/forfeit per policy, numbered TC, QR verify |
| W-12 | Certificate request & issue | M18, M04 | Request → Issued / Revoked | Template version, serial, approver, verification page, revocation |
| W-13 | Employee onboarding & exit | M12, M00, M06, M16 | Offer → Active → Exited | User provisioning, role assignment, exit checklist: delegate approvals, return assets, revoke access, F&F settlement |
| W-14 | Library circulation | M15, M10 | Issue → Returned / Lost | Member limits, holds, overdue fines, lost-copy charges |
| W-15 | Bulk import | M00 + target module | Upload → Committed | Staging, row validation, dry run, idempotent commit, audit |
| W-16 | Tenant onboarding & offboarding | M01, M02 | Signup → Active … Offboarded | Plan, entitlements, seed templates, grace, export package, verified deletion after retention |
| W-17 | Journal entry (manual) & period close | M11 | Draft → Posted / Reversed; Period open → closed | Maker-checker above threshold, balanced, period state, reopening approval |
| W-18 | Data-subject request | M20 | Received → Fulfilled / Rejected | Identity verification, SLA, retention/legal-hold check, evidence |

## 2. Core state machines (initial)

```
Application (W-01):  DRAFT → SUBMITTED → UNDER_REVIEW ⇄ RETURNED_FOR_CORRECTION
                     UNDER_REVIEW → SHORTLISTED → (INTERVIEW/TEST) → DECIDED{APPROVED|REJECTED|WAITLISTED}
                     WAITLISTED → APPROVED | EXPIRED
                     APPROVED → OFFERED → ACCEPTED → ENROLLED   (OFFERED → DECLINED | OFFER_EXPIRED)
                     any pre-ENROLLED → WITHDRAWN

Enrolment:           PENDING → ACTIVE → {COMPLETED | PROMOTED | TRANSFERRED | WITHDRAWN | DETAINED}
                     (effective-dated; exactly one ACTIVE per student per academic scope)

Attendance session:  GENERATED → IN_PROGRESS → SUBMITTED → (REVIEW_REQUIRED →) APPROVED → PUBLISHED
                     Corrections create attendance_corrections; records stay versioned.

Result:              DRAFT → CALCULATED → VERIFIED → APPROVED → SCHEDULED → PUBLISHED
                     PUBLISHED → (revaluation/supplementary) new RESULT VERSION; old version SUPERSEDED.

Invoice:             DRAFT → ISSUED → PARTIALLY_PAID → PAID ; ISSUED → CANCELLED (only if no allocation; via credit note after posting)
Payment (online):    CREATED → PENDING → {CAPTURED → SETTLED → RECONCILED | FAILED | EXPIRED} ; CAPTURED → REFUND_PENDING → REFUNDED
Instrument (cheque): RECEIVED → DEPOSITED → {CLEARED | BOUNCED}  (BOUNCED reverses the receipt, may add a bounce charge)
Receipt:             ISSUED (only from CAPTURED/CLEARED or cash) → REVERSED (never deleted)

Journal:             DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED (by a linked reversal journal)
Accounting period:   OPEN → SOFT_CLOSED → CLOSED → (REOPENED with approval → OPEN)
Payroll run:         DRAFT → INPUTS_FROZEN → CALCULATED → REVIEWED → APPROVED → DISBURSING → PAID → POSTED
Purchase order:      DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → PARTIALLY_RECEIVED → RECEIVED → CLOSED | CANCELLED
Tenant:              PROVISIONING → TRIAL → ACTIVE → {GRACE → SUSPENDED → ACTIVE} → OFFBOARDING → ARCHIVED → PURGED
```

## 3. Cross-module integration contracts

For every integration: **source of truth · trigger · validation · transaction boundary · failure handling · retry · audit · reconciliation**.

| # | Integration | Source of truth | Trigger | Transaction boundary | Failure / retry | Reconciliation |
|---|---|---|---|---|---|---|
| I-1 | Admission → Student + Enrolment | M03 decision; M04 owns the student | `AcceptOffer` command | **Single DB transaction**: application → ENROLLED, student, enrolment, number allocation, guardian links | Any failure rolls back everything; retry with the same idempotency key is safe | Daily report: ACCEPTED applications without an enrolment = 0 |
| I-2 | Enrolment → Fee assignment | M10 owns assignments | Outbox `enrolment.activated/changed` | Consumer transaction in M10 | Idempotent by (enrolment_id, structure_version); dead-letter on rule error → fee desk queue | "Active enrolments without assignment" report |
| I-3 | Fees → GL | M11 owns journals | Invoice issue, receipt, refund, write-off | **Same transaction** as the source document via in-process `PostingService` | Posting failure fails the source operation (no unposted receipts). Mapping missing → 422 | TB control account = subledger total (daily job) |
| I-4 | Gateway webhook → Payment | Provider is the truth for status; M10 for allocation | Signed webhook / polling | Persist raw webhook (unique provider event id) → async process → state transition | Retries with backoff; out-of-order handled by the state machine; stuck PENDING → provider status poll | Settlement report import matches payouts → RECONCILED |
| I-5 | Timetable → Attendance sessions | M06 published version | Publish event + daily scheduler | Per day/campus batch, idempotent on (offering, date, period) | Re-generation is safe | Missing-register dashboard |
| I-6 | Attendance/Fees → Exam eligibility | M08 / M10 | Registration action | Read-only check at registration; a snapshot of the values is stored | N/A | Eligibility override log (with approver) |
| I-7 | Attendance/Leave → Payroll | M08 / leave engine | Payroll period inputs freeze | Snapshot copied into the payroll run | Later corrections → arrears in the next run | Inputs snapshot vs live diff report |
| I-8 | Payroll → GL / bank | M12 run; M11 | Run APPROVED / PAID | Posting in the same transaction as the PAID/POSTED transition | Bank file rejection → partial-paid handling | Bank statement match |
| I-9 | GRN / vendor bill → Inventory / AP | M16 / M11 | GRN accept; bill approve | GRN + stock movement in one transaction; bill + AP journal in one transaction | 3-way-match variance → hold | GRNI (goods received not invoiced) report |
| I-10 | Hostel/Transport/Library → Fees | M10 | Allotment/assignment/fine | Charge request via the M10 API (same transaction where synchronous) | Idempotent by source reference | Charges vs active allotments report |
| I-11 | Any → Notifications | M17 | Outbox events | Outbox row written with the business change | Retry, provider failover, dedupe key | Delivery status dashboard |
| I-12 | Any → Audit | M00 audit | Interceptor + domain events | Audit row in the **same transaction** as the change | N/A (fails with the business write) | Hash-chain verification job |

## 4. Edge cases [DOC §5] → handling owner

All 15 edge cases from the PDF are adopted. Each is mapped to a test in [TEST_STRATEGY.md](TEST_STRATEGY.md) §4. Notable implementation choices:
- **Duplicate/out-of-order payment callbacks:** unique `(provider, provider_event_id)` + state machine + a `FOR UPDATE` lock on the payment row.
- **Biometric offline replay:** unique `(device_id, device_event_id)`, keep device time and ingestion time, plus a clock-drift tolerance setting.
- **GPS stale or jump points:** store `event_time` and `received_at`, flag stale points (> N s) and impossible speed (> configurable km/h).
- **Two guardians with different rights:** access scope lives on `student_guardians` per link, never on the guardian.
- **Subscription suspended:** read-only + export allowed during grace. No data deletion before offboarding completes.
