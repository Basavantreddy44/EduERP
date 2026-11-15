# Data Dictionary

Field-level definitions are added **when each table is migrated**. This keeps the dictionary in sync with real migrations. Phase 0 (M0.1) tables are drafted below for review. They are **not yet implemented**.

Column format: `name | type | null | default | constraints | description | classification`.

## Common columns (all tenant-owned tables)
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | N | PK, UUIDv7 |
| tenant_id | uuid | N | FK tenants; `UNIQUE(tenant_id,id)`; RLS key |
| created_at / updated_at | timestamptz | N | now() |
| created_by / updated_by | uuid | Y | user id (null for system) |
| version | int | N | 1, optimistic lock |

## tenants (platform)
| Column | Type | Null | Constraints | Description |
|---|---|---|---|---|
| slug | citext | N | UNIQUE, `^[a-z0-9-]{3,40}$` | Subdomain / URL key |
| legal_name | text | N | | Registered name |
| display_name | text | N | | |
| status | tenant_status | N | enum PROVISIONING, TRIAL, ACTIVE, GRACE, SUSPENDED, OFFBOARDING, ARCHIVED, PURGED | Lifecycle |
| default_timezone | text | N | IANA tz, default `Asia/Kolkata` | |
| country_code | char(2) | N | default `IN` | |
| institution_types | text[] | N | values SCHOOL, COLLEGE, OTHER | Template selection |

## legal_entities
| Column | Type | Null | Constraints | Description |
|---|---|---|---|---|
| code | text | N | UNIQUE(tenant_id, code) | |
| legal_name | text | N | | Trust / society / company name |
| entity_type | text | N | TRUST, SOCIETY, SECTION8_COMPANY, COMPANY, GOVT, OTHER | |
| pan | text | Y | encrypted, masked | Confidential |
| base_currency | char(3) | N | default INR | |
| fiscal_year_start_month | smallint | N | 1–12, default 4 | |

## campuses
| Column | Type | Null | Constraints | Description |
|---|---|---|---|---|
| legal_entity_id | uuid | N | FK (tenant_id, legal_entity_id) | Books owner |
| code | text | N | UNIQUE(tenant_id, code), `^[A-Z0-9_-]{2,20}$` | |
| name | text | N | 2–150 chars | |
| timezone | text | N | IANA | |
| address | jsonb | Y | validated schema (line1, city, state_code, pincode) | |
| status | text | N | ACTIVE, INACTIVE, CLOSED | Closed campuses stay read-only |

## users (global, no tenant_id)
| Column | Type | Null | Constraints | Description |
|---|---|---|---|---|
| email_normalised | citext | Y | UNIQUE where not null | |
| phone_e164 | text | Y | UNIQUE where not null, E.164 | |
| password_hash | text | Y | argon2id | Null for OTP-only users |
| status | text | N | ACTIVE, LOCKED, DISABLED | |
| mfa_enabled | boolean | N | false | |
| CHECK | | | email or phone required | |

## user_tenants
`tenant_id, user_id (UNIQUE pair), membership_status (INVITED, ACTIVE, SUSPENDED, REVOKED), joined_at, revoked_at`.

## user_roles
`tenant_id, user_id, role_id, scope_type (TENANT|LEGAL_ENTITY|CAMPUS|DEPARTMENT|STUDENT_GROUP|SELF|…), scope_id (nullable for TENANT), valid_from, valid_to`. UNIQUE(tenant_id, user_id, role_id, scope_type, scope_id).

## audit_logs (append-only)
`tenant_id (nullable for platform events), occurred_at, actor_user_id, actor_type (USER|SYSTEM|PLATFORM_SUPPORT), action, entity_type, entity_id, campus_id, reason, changes jsonb (redacted diff), ip, user_agent, correlation_id, prev_hash, hash`. No UPDATE/DELETE grants. Partitioned by month when volume warrants.

## outbox_events
`tenant_id, event_type, aggregate_type, aggregate_id, payload jsonb, occurred_at, status (PENDING|DISPATCHED|FAILED), attempts, next_attempt_at, dedupe_key UNIQUE`.

## idempotency_keys
`tenant_id, key, endpoint, request_hash, response_status, response_body jsonb, created_at, expires_at`. UNIQUE(tenant_id, key, endpoint).
