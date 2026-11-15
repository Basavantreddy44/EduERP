import { z } from 'zod';

/**
 * Notification event catalogue. Each event lists the channels it may use, whether recipients may opt
 * out, and the variables its templates can use. Platform default templates (English and Kannada) are
 * seeded from DEFAULT_TEMPLATES; an institution can override any of them.
 */
export const CHANNELS = ['IN_APP', 'PUSH', 'SMS', 'WHATSAPP', 'EMAIL'] as const;
export type Channel = (typeof CHANNELS)[number];
export type Language = 'en' | 'kn';

export interface NotificationEvent {
  code: string;
  label: string;
  channels: Channel[];
  /** Mandatory events ignore opt-outs (e.g. security notices). */
  mandatory: boolean;
  variables: string[];
}

export const NOTIFICATION_EVENTS = {
  APPROVAL_PENDING: { code: 'APPROVAL_PENDING', label: 'Approval waiting for you', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['entityLabel', 'summary', 'requesterName'] },
  APPROVAL_APPROVED: { code: 'APPROVAL_APPROVED', label: 'Your request was approved', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['entityLabel', 'summary'] },
  APPROVAL_REJECTED: { code: 'APPROVAL_REJECTED', label: 'Your request was rejected', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['entityLabel', 'summary', 'remarks'] },
  ACCOUNT_SECURITY: { code: 'ACCOUNT_SECURITY', label: 'Account security notice', channels: ['IN_APP', 'EMAIL'], mandatory: true, variables: ['message'] },
} as const satisfies Record<string, NotificationEvent>;

export type NotificationEventCode = keyof typeof NOTIFICATION_EVENTS;

export interface TemplateText {
  eventCode: NotificationEventCode;
  channel: Channel;
  language: Language;
  subject: string | null;
  body: string;
}

/**
 * Platform defaults. Kannada text should be reviewed by a native speaker before launch
 * (tracked in DEVELOPMENT_STATUS); placeholders are {{variable}}.
 */
export const DEFAULT_TEMPLATES: TemplateText[] = [
  // APPROVAL_PENDING
  { eventCode: 'APPROVAL_PENDING', channel: 'IN_APP', language: 'en', subject: 'Approval needed: {{entityLabel}}', body: '{{requesterName}} submitted a {{entityLabel}} for your approval. {{summary}}' },
  { eventCode: 'APPROVAL_PENDING', channel: 'IN_APP', language: 'kn', subject: 'ಅನುಮೋದನೆ ಅಗತ್ಯವಿದೆ: {{entityLabel}}', body: '{{requesterName}} ಅವರು ಸಲ್ಲಿಸಿದ {{entityLabel}} ನಿಮ್ಮ ಅನುಮೋದನೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ. {{summary}}' },
  { eventCode: 'APPROVAL_PENDING', channel: 'EMAIL', language: 'en', subject: 'Approval needed: {{entityLabel}}', body: 'Hello,\n\n{{requesterName}} submitted a {{entityLabel}} for your approval.\n\n{{summary}}\n\nPlease sign in to EduERP to approve or reject it.' },
  { eventCode: 'APPROVAL_PENDING', channel: 'EMAIL', language: 'kn', subject: 'ಅನುಮೋದನೆ ಅಗತ್ಯವಿದೆ: {{entityLabel}}', body: 'ನಮಸ್ಕಾರ,\n\n{{requesterName}} ಅವರು ಸಲ್ಲಿಸಿದ {{entityLabel}} ನಿಮ್ಮ ಅನುಮೋದನೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ.\n\n{{summary}}\n\nಅನುಮೋದಿಸಲು ಅಥವಾ ತಿರಸ್ಕರಿಸಲು ದಯವಿಟ್ಟು EduERP ಗೆ ಲಾಗಿನ್ ಮಾಡಿ.' },
  // APPROVAL_APPROVED
  { eventCode: 'APPROVAL_APPROVED', channel: 'IN_APP', language: 'en', subject: 'Approved: {{entityLabel}}', body: 'Your {{entityLabel}} has been approved. {{summary}}' },
  { eventCode: 'APPROVAL_APPROVED', channel: 'IN_APP', language: 'kn', subject: 'ಅನುಮೋದಿಸಲಾಗಿದೆ: {{entityLabel}}', body: 'ನಿಮ್ಮ {{entityLabel}} ಅನುಮೋದಿಸಲಾಗಿದೆ. {{summary}}' },
  { eventCode: 'APPROVAL_APPROVED', channel: 'EMAIL', language: 'en', subject: 'Approved: {{entityLabel}}', body: 'Hello,\n\nYour {{entityLabel}} has been approved.\n\n{{summary}}' },
  { eventCode: 'APPROVAL_APPROVED', channel: 'EMAIL', language: 'kn', subject: 'ಅನುಮೋದಿಸಲಾಗಿದೆ: {{entityLabel}}', body: 'ನಮಸ್ಕಾರ,\n\nನಿಮ್ಮ {{entityLabel}} ಅನುಮೋದಿಸಲಾಗಿದೆ.\n\n{{summary}}' },
  // APPROVAL_REJECTED
  { eventCode: 'APPROVAL_REJECTED', channel: 'IN_APP', language: 'en', subject: 'Rejected: {{entityLabel}}', body: 'Your {{entityLabel}} was rejected. {{remarks}}' },
  { eventCode: 'APPROVAL_REJECTED', channel: 'IN_APP', language: 'kn', subject: 'ತಿರಸ್ಕರಿಸಲಾಗಿದೆ: {{entityLabel}}', body: 'ನಿಮ್ಮ {{entityLabel}} ತಿರಸ್ಕರಿಸಲಾಗಿದೆ. {{remarks}}' },
  { eventCode: 'APPROVAL_REJECTED', channel: 'EMAIL', language: 'en', subject: 'Rejected: {{entityLabel}}', body: 'Hello,\n\nYour {{entityLabel}} was rejected.\n\nRemarks: {{remarks}}\n\n{{summary}}' },
  { eventCode: 'APPROVAL_REJECTED', channel: 'EMAIL', language: 'kn', subject: 'ತಿರಸ್ಕರಿಸಲಾಗಿದೆ: {{entityLabel}}', body: 'ನಮಸ್ಕಾರ,\n\nನಿಮ್ಮ {{entityLabel}} ತಿರಸ್ಕರಿಸಲಾಗಿದೆ.\n\nಟಿಪ್ಪಣಿ: {{remarks}}\n\n{{summary}}' },
  // ACCOUNT_SECURITY (mandatory)
  { eventCode: 'ACCOUNT_SECURITY', channel: 'IN_APP', language: 'en', subject: 'Account security notice', body: '{{message}}' },
  { eventCode: 'ACCOUNT_SECURITY', channel: 'IN_APP', language: 'kn', subject: 'ಖಾತೆ ಭದ್ರತಾ ಸೂಚನೆ', body: '{{message}}' },
  { eventCode: 'ACCOUNT_SECURITY', channel: 'EMAIL', language: 'en', subject: 'Account security notice', body: 'Hello,\n\n{{message}}\n\nIf this was not you, contact your institution administrator.' },
  { eventCode: 'ACCOUNT_SECURITY', channel: 'EMAIL', language: 'kn', subject: 'ಖಾತೆ ಭದ್ರತಾ ಸೂಚನೆ', body: 'ನಮಸ್ಕಾರ,\n\n{{message}}\n\nಇದು ನೀವಲ್ಲದಿದ್ದರೆ, ನಿಮ್ಮ ಸಂಸ್ಥೆಯ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.' },
];

/** Replaces {{name}} placeholders; unknown placeholders become empty. Values are plain text (no HTML). */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k]))).replace(/[ \t]+$/gm, '').trim();
}

export const notificationsQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const putPreferenceSchema = z.object({
  eventCode: z.enum(Object.keys(NOTIFICATION_EVENTS) as [NotificationEventCode, ...NotificationEventCode[]]),
  channel: z.enum(CHANNELS),
  isEnabled: z.boolean(),
});
export type PutPreferenceInput = z.infer<typeof putPreferenceSchema>;
