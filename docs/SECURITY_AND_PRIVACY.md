# Security & Privacy Assessment

Baseline **[DOC §16]**. *Not legal advice. All India-specific items need qualified counsel review (ASM-05).*

## 1. Data classification

| Class | Examples | Controls |
|---|---|---|
| Public | Institution name, public certificate verification result (minimal fields) | None beyond integrity |
| Internal | Timetables, announcements | AuthN + tenant scope |
| Confidential | Student/employee profiles, marks, fees, invoices | RBAC/ABAC, audit on export |
| Sensitive personal | Children's data, guardian contacts, location (GPS), salary, bank details, government ID numbers | Field-level encryption (ID numbers, bank accounts), masking by default, reveal audit, consent-bound |
| Highly restricted | Medical notes, custody restrictions, disciplinary records, biometric identifiers, credentials | Separate permission, separate table, access log on every read, minimised retention. **No raw biometric templates** [DOC §16] |

## 2. Threat model (STRIDE summary, top risks)

| Threat | Vector | Primary controls |
|---|---|---|
| Cross-tenant data access | IDOR, missing filter, job without context, report query | Tenant-bound token, RLS (FORCE), composite FKs, 404-on-out-of-scope, breakout test suite in CI |
| Cross-campus / relationship access | Guardian guessing student IDs; teacher viewing another section | ABAC ScopeFilter in repositories, relationship flags, tests per role |
| Account takeover | Credential stuffing, OTP brute force, SIM swap | argon2id, breached-password check, rate limits, lockout with backoff, MFA for staff/finance, OTP attempts cap, new-device alerts |
| Session theft | XSS, token leakage | httpOnly+Secure+SameSite cookies for refresh, short access TTL, CSP, output encoding, refresh rotation with reuse detection → revoke family |
| Financial fraud | Self-approved refunds, edited receipts, fake webhooks | SoD, maker-checker, immutability triggers, signature-verified webhooks, reconciliation |
| Tampering with evidence | Editing marks/attendance/audit | Versioned results, correction workflow, append-only hash-chained audit |
| Insider/platform misuse | Support staff browsing tenant data | Time-boxed tenant-approved grants, session recording in audit, alerts |
| Malicious files | Uploading malware/HTML | Type/size allow-list, magic-byte check, AV scan before availability, served as attachment from a separate domain via signed URLs |
| Injection / SSRF | Raw SQL, URL fetchers (ISBN lookup, webhooks) | Prisma parameterisation, raw-SQL review rule, egress allow-list for outbound fetchers |
| DoS / noisy neighbour | Bulk exports, report storms | Per-tenant rate limits, async jobs with concurrency caps, WAF |
| Data exfiltration via export | Over-broad exports | Export permission, column-level filters, async + expiring URLs, export log, optional watermark |

## 3. Security controls by layer

- **Identity:** argon2id; MFA (TOTP) mandatory for TENANT_OWNER/ADMIN, finance, payroll and platform roles; step-up MFA for sensitive actions (refund approve, period reopen, payroll disburse, role grant); session list + remote logout + device revocation [DOC §13, §16].
- **Authorisation:** deny-by-default guards; permission decorators on every controller method; CI test fails if any route lacks a permission decorator or `@Public()`.
- **Application:** Zod validation on every input; helmet/CSP; CSRF protection for cookie-authenticated endpoints; CORS allow-list per tenant domain; secure headers; error responses without stack traces/SQL [DOC §6].
- **Data:** TLS 1.2+; encryption at rest (DB, backups, object storage); field-level encryption (envelope, KMS) for ID numbers and bank accounts; log redaction.
- **Supply chain/SDLC:** lockfile, Renovate, `pnpm audit`/OSV, CodeQL/Semgrep (SAST), gitleaks, Trivy image scanning, signed images, PR reviews, DAST (ZAP) on staging; penetration test before go-live [DOC §16].
- **Audit:** `audit_logs` append-only, hash-chained per tenant (`hash = H(prev_hash || row)`), daily verification job; shipped to a separate store for tamper evidence.
- **Secrets:** cloud secrets manager; no secrets in repo; `.env.example` only; per-tenant provider credentials encrypted.

## 4. Privacy (India) assessment

| Topic | Position / recommendation | Status |
|---|---|---|
| DPDP Act 2023 roles | Institution (tenant) = **Data Fiduciary**; we = **Data Processor** for tenant data, Fiduciary for platform account data | ASM-05 legal |
| Children's data | Verifiable parental consent for processing a child's data; no tracking/behavioural monitoring or targeted advertising of children; this affects GPS tracking and AI "risk" indicators. Design consent capture + purpose checks; avoid profiling-type AI on minors without legal sign-off | G-15, legal |
| Notice & consent | Purpose-specific notices in English + regional language; consent ledger with withdrawal | P1 |
| Data principal rights | Access, correction, erasure, grievance redressal, nomination; DSR workflow W-18 with SLA | P9 (model from P0) |
| Retention | Per data class; statutory financial/academic retention overrides erasure → pseudonymise | G-20 |
| Breach notification | Notify Data Protection Board and affected principals per rules; CERT-In reporting within 6 hours for specified incidents; incident runbook | G-18 |
| Aadhaar | Avoid storage; if required, masked + vaulted per UIDAI norms | G-16, DEC-15 |
| Location data | Driver app foreground-only during an active trip; parent view only during the tracking window; retention limit (proposed 90 days raw, aggregated thereafter) | DEC-12 |
| Data residency | India region hosting | DEC-10 |
| Processor contracts | DPA template with tenants; sub-processor list (SMS, WhatsApp, payment, cloud) | Business |

## 5. Incident response [DOC §16]
Severity levels S1–S4, incident commander rota, communications owner, evidence preservation, tenant impact assessment, regulator/tenant notification decision log, RCA within 5 working days, corrective actions tracked.
