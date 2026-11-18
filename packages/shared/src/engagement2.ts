import { z } from 'zod';

/** Engagement II (Phase 12): staff meetings & minutes, complaints, front office, department requests. */

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');
/** Mobile or landline (with STD code); spaces and dashes are dropped. */
const anyPhone = z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{6,15}$/, 'Enter a phone number (6 to 15 digits)'));

// ───────────── M12.1 Staff meetings & minutes ─────────────

export const COMMITTEE_ROLES = ['CHAIR', 'SECRETARY', 'MEMBER'] as const;
export const committeeSchema = z.object({
  campusId: uuid.optional().nullable(),
  name: z.string().trim().min(3).max(150),
  description: optText(500),
  members: z.array(z.object({ employeeId: uuid, memberRole: z.enum(COMMITTEE_ROLES) })).min(1).max(60)
    .refine((v) => new Set(v.map((m) => m.employeeId)).size === v.length, 'A member is listed twice')
    .refine((v) => v.filter((m) => m.memberRole === 'CHAIR').length === 1, 'Choose one chair'),
});
export type CommitteeInput = z.infer<typeof committeeSchema>;

export const MEETING_TYPES = ['STAFF', 'DEPARTMENT', 'COMMITTEE', 'MANAGEMENT', 'OTHER'] as const;
export const meetingSchema = z.object({
  campusId: uuid.optional().nullable(),
  meetingType: z.enum(MEETING_TYPES),
  committeeId: uuid.optional().nullable(),
  departmentId: uuid.optional().nullable(),
  title: z.string().trim().min(3).max(200),
  startAt: instant,
  endAt: instant,
  venue: optText(200),
  meetingLink: z.string().trim().url().max(500).refine((u) => /^https:\/\//i.test(u), 'Use an https:// link').optional().nullable(),
  /** Extra invitees (staff) besides the committee's members or the department's staff. */
  employeeIds: z.array(uuid).max(300).default([]),
  agenda: z.array(z.string().trim().min(2).max(300)).max(30).default([]),
}).refine((v) => v.endAt > v.startAt, { message: 'Ends before it starts', path: ['endAt'] })
  .refine((v) => v.meetingType !== 'COMMITTEE' || !!v.committeeId, { message: 'Choose the committee', path: ['committeeId'] })
  .refine((v) => v.meetingType !== 'DEPARTMENT' || !!v.departmentId, { message: 'Choose the department', path: ['departmentId'] });
export type MeetingInput = z.infer<typeof meetingSchema>;
export const rsvpSchema = z.object({ accept: z.boolean() });
export const meetingAttendanceSchema = z.object({ rows: z.array(z.object({ employeeId: uuid, attended: z.boolean() })).max(300) });
export const minutesSchema = z.object({ minutesText: z.string().trim().min(10).max(20000) });
export const ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const actionItemSchema = z.object({ description: z.string().trim().min(3).max(500), ownerEmployeeId: uuid, dueDate: z.string().date() });
export type ActionItemInput = z.infer<typeof actionItemSchema>;
export const actionStatusSchema = z.object({ status: z.enum(ACTION_STATUSES), note: optText(300) });

// ───────────── M12.2 Complaints ─────────────

export const REQUEST_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'] as const;
export const complaintCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  defaultEmployeeId: uuid.optional().nullable(),
  slaHours: z.coerce.number().int().min(1).max(24 * 30),
  isSensitive: z.boolean().default(false),
});
export type ComplaintCategoryInput = z.infer<typeof complaintCategorySchema>;
export const complaintSchema = z.object({
  categoryId: uuid,
  studentId: uuid.optional().nullable(),
  subject: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(5000),
  priority: z.enum(REQUEST_PRIORITIES).default('MEDIUM'),
});
export type ComplaintInput = z.infer<typeof complaintSchema>;
export const complaintUpdateSchema = z.object({
  message: z.string().trim().min(2).max(3000),
  /** Staff-only note (never shown to the complainant). */
  isInternal: z.boolean().default(false),
  status: z.enum(['IN_PROGRESS', 'RESOLVED']).optional().nullable(),
  assignToEmployeeId: uuid.optional().nullable(),
});
export type ComplaintUpdateInput = z.infer<typeof complaintUpdateSchema>;
export const complaintCloseSchema = z.object({ close: z.boolean(), rating: z.coerce.number().int().min(1).max(5).optional().nullable(), message: optText(1000) })
  .refine((v) => !v.close || !!v.rating, { message: 'Give a rating', path: ['rating'] })
  .refine((v) => v.close || !!v.message, { message: 'Say what is still wrong', path: ['message'] });

// ───────────── M12.3 Front office ─────────────

export const VISIT_PURPOSES = ['PARENT_VISIT', 'ADMISSION', 'VENDOR', 'INTERVIEW', 'OFFICIAL', 'OTHER'] as const;
export const ID_PROOFS = ['AADHAAR', 'DRIVING_LICENCE', 'VOTER_ID', 'PAN', 'OTHER'] as const;
export const frontVisitorSchema = z.object({
  campusId: uuid,
  visitorName: z.string().trim().min(2).max(150),
  phone,
  idProofType: z.enum(ID_PROOFS).optional().nullable(),
  /** Only the last 4 characters of the ID are kept. */
  idProofLast4: z.string().trim().regex(/^[A-Za-z0-9]{4}$/, 'Only the last 4 characters').optional().nullable(),
  purpose: z.enum(VISIT_PURPOSES),
  purposeNote: optText(200),
  whomToMeetEmployeeId: uuid.optional().nullable(),
  studentId: uuid.optional().nullable(),
  vehicleNo: optText(20),
});
export type FrontVisitorInput = z.infer<typeof frontVisitorSchema>;

export const gatePassSchema = z.object({
  campusId: uuid,
  passType: z.enum(['STUDENT', 'STAFF']),
  studentId: uuid.optional().nullable(),
  employeeId: uuid.optional().nullable(),
  reason: z.string().trim().min(3).max(300),
  pickupGuardianId: uuid.optional().nullable(),
  pickupPersonName: optText(150),
  pickupPersonPhone: phone.optional().nullable(),
  expectedReturn: instant.optional().nullable(),
}).refine((v) => (v.passType === 'STUDENT') === !!v.studentId && (v.passType === 'STAFF') === !!v.employeeId, { message: 'Choose the student or staff member', path: ['studentId'] })
  .refine((v) => v.passType === 'STAFF' || !!v.pickupGuardianId || !!v.pickupPersonName, { message: 'Who is collecting the student?', path: ['pickupGuardianId'] });
export type GatePassInput = z.infer<typeof gatePassSchema>;

export const callLogSchema = z.object({
  campusId: uuid,
  callType: z.enum(['INCOMING', 'OUTGOING']),
  callerName: z.string().trim().min(2).max(150),
  phone: anyPhone,
  purpose: z.string().trim().min(3).max(300),
  followUpDate: z.string().date().optional().nullable(),
});
export type CallLogInput = z.infer<typeof callLogSchema>;

export const postalSchema = z.object({
  campusId: uuid,
  direction: z.enum(['INWARD', 'OUTWARD']),
  fromParty: z.string().trim().min(2).max(200),
  toParty: z.string().trim().min(2).max(200),
  courierName: optText(100),
  trackingNo: optText(50),
  addressedToEmployeeId: uuid.optional().nullable(),
  remarks: optText(300),
});
export type PostalInput = z.infer<typeof postalSchema>;

// ───────────── M12.4 Department requests ─────────────

export const requestCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  toDepartmentId: uuid,
  requiresApproval: z.boolean().default(false),
  slaHours: z.coerce.number().int().min(1).max(24 * 60),
});
export type RequestCategoryInput = z.infer<typeof requestCategorySchema>;
export const deptRequestSchema = z.object({
  campusId: uuid,
  fromDepartmentId: uuid,
  categoryId: uuid,
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(3000),
  priority: z.enum(REQUEST_PRIORITIES).default('MEDIUM'),
  neededBy: z.string().date().optional().nullable(),
});
export type DeptRequestInput = z.infer<typeof deptRequestSchema>;
export const deptRequestUpdateSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional().nullable(),
  assignToEmployeeId: uuid.optional().nullable(),
});
export type DeptRequestUpdateInput = z.infer<typeof deptRequestUpdateSchema>;
