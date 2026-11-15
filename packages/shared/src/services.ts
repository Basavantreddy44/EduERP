import { z } from 'zod';

// ───────────── Numbering (G-05) ─────────────

/** Document types that use number series. Modules add theirs here. */
export const DOC_TYPES = ['ENQUIRY', 'ADMISSION', 'APPLICATION', 'RECEIPT', 'INVOICE', 'EMPLOYEE', 'TC', 'JOURNAL', 'TEST'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const createSequenceSchema = z.object({
  campusId: z.string().uuid().nullable().optional(), // null = institution-wide series
  docType: z.enum(DOC_TYPES),
  prefix: z.string().trim().max(30).regex(/^[A-Za-z0-9/_\-.]*$/, 'Letters, digits and / _ - . only').default(''),
  yearLabel: z.string().trim().max(10).regex(/^[A-Za-z0-9\-]*$/, 'Letters, digits and - only').default(''),
  startAt: z.number().int().min(1).default(1),
  padding: z.number().int().min(1).max(12).default(5),
});
export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;

// ───────────── Files ─────────────

export const FILE_ENTITY_TYPES = ['TENANT', 'CAMPUS', 'USER', 'STUDENT', 'EMPLOYEE', 'APPLICATION', 'GENERAL'] as const;
export const FILE_DOC_TYPES = ['LOGO', 'PHOTO', 'BIRTH_CERT', 'AADHAAR_MASKED', 'TC', 'MARKS_CARD', 'OTHER'] as const;
/** What we accept, detected from the file's content (not from the browser-supplied type). */
export const ALLOWED_FILE_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const uploadFileSchema = z.object({
  entityType: z.enum(FILE_ENTITY_TYPES),
  entityId: z.string().uuid().optional(),
  docType: z.enum(FILE_DOC_TYPES),
  campusId: z.string().uuid().optional(),
});
export type UploadFileInput = z.infer<typeof uploadFileSchema>;

export const listFilesQuerySchema = z.object({
  entityType: z.enum(FILE_ENTITY_TYPES),
  entityId: z.string().uuid().optional(),
});

// ───────────── Approvals (G-04) ─────────────

/** Business records that can need approval. Modules add theirs here. */
export const APPROVAL_ENTITY_TYPES = ['CONCESSION', 'REFUND', 'LEAVE', 'OUTPASS', 'PURCHASE_ORDER', 'TEST'] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number];
export const APPROVAL_ENTITY_LABELS: Record<ApprovalEntityType, string> = {
  CONCESSION: 'Fee concession',
  REFUND: 'Fee refund',
  LEAVE: 'Leave request',
  OUTPASS: 'Out-pass',
  PURCHASE_ORDER: 'Purchase order',
  TEST: 'Test request',
};

const money = z.number().nonnegative().max(999_999_999_999.99).multipleOf(0.01);

export const createApprovalRuleSchema = z.object({
  campusId: z.string().uuid().nullable().optional(),
  entityType: z.enum(APPROVAL_ENTITY_TYPES),
  minAmount: money.nullable().optional(),
  levelNo: z.number().int().min(1).max(5),
  approverRoleId: z.string().uuid(),
});
export type CreateApprovalRuleInput = z.infer<typeof createApprovalRuleSchema>;

export const approvalActionSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT']),
    remarks: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action === 'APPROVE' || (v.remarks && v.remarks.length >= 3), { message: 'Give a reason when rejecting', path: ['remarks'] });
export type ApprovalActionInput = z.infer<typeof approvalActionSchema>;

export const approvalListQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  entityType: z.enum(APPROVAL_ENTITY_TYPES).optional(),
});
