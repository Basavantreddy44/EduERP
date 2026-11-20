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
  TRANSPORT_EXPIRY: { code: 'TRANSPORT_EXPIRY', label: 'Bus document or licence expiring', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['what', 'whose', 'validTo', 'days'] },
  HOSTEL_ABSENT: { code: 'HOSTEL_ABSENT', label: 'Child absent at hostel roll-call', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['student', 'hostel', 'date'] },
  SUBSTITUTION: { code: 'SUBSTITUTION', label: 'You are substituting a class', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['section', 'subject', 'period', 'date', 'absent'] },
  HOMEWORK: { code: 'HOMEWORK', label: 'New homework', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['subject', 'title', 'dueDate', 'section'] },
  DIARY_NOTE: { code: 'DIARY_NOTE', label: 'Note from the class teacher', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['section', 'note'] },
  MEETING_INVITE: { code: 'MEETING_INVITE', label: 'Meeting invitation', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['title', 'when'] },
  ACTION_ASSIGNED: { code: 'ACTION_ASSIGNED', label: 'Action item for you', channels: ['IN_APP'], mandatory: false, variables: ['description', 'due'] },
  COMPLAINT_UPDATE: { code: 'COMPLAINT_UPDATE', label: 'Update on a complaint', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['no', 'subject', 'status'] },
  COMPLAINT_ESCALATED: { code: 'COMPLAINT_ESCALATED', label: 'Complaint overdue', channels: ['IN_APP', 'EMAIL'], mandatory: true, variables: ['no', 'subject'] },
  DEPT_REQUEST: { code: 'DEPT_REQUEST', label: 'Request to your department', channels: ['IN_APP'], mandatory: false, variables: ['no', 'title', 'status'] },
  FEED_POST: { code: 'FEED_POST', label: 'New post in the school news', channels: ['IN_APP'], mandatory: false, variables: ['title'] },
  EVENT_INVITE: { code: 'EVENT_INVITE', label: 'New school event', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['title', 'date', 'student'] },
  PTM_BOOKED: { code: 'PTM_BOOKED', label: 'Parent-teacher meeting booked', channels: ['IN_APP'], mandatory: false, variables: ['student', 'teacher', 'date', 'time'] },
  RESULT_PUBLISHED: { code: 'RESULT_PUBLISHED', label: 'Results published', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['student', 'term', 'section'] },
  HOSTEL_OUTPASS: { code: 'HOSTEL_OUTPASS', label: 'Outpass waiting for your approval', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['student', 'destination', 'outTime', 'expectedReturn'] },
  LIBRARY_OVERDUE: { code: 'LIBRARY_OVERDUE', label: 'Library book overdue', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['who', 'title', 'dueDate', 'days'] },
  LIBRARY_READY: { code: 'LIBRARY_READY', label: 'Reserved library book ready', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['who', 'title', 'until'] },
  INFIRMARY_VISIT: { code: 'INFIRMARY_VISIT', label: 'Child seen in the school infirmary', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['student', 'complaint', 'outcome', 'time'] },
  DISCIPLINE_INCIDENT: { code: 'DISCIPLINE_INCIDENT', label: 'Behaviour incident', channels: ['IN_APP', 'EMAIL'], mandatory: false, variables: ['student', 'type', 'date'] },
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
  // SUBSTITUTION, HOMEWORK, DIARY_NOTE (Phase 8)
  { eventCode: 'SUBSTITUTION', channel: 'IN_APP', language: 'en', subject: 'Substitute class: {{section}} on {{date}}', body: 'Please take {{subject}} for {{section}} in {{period}} on {{date}} ({{absent}} is away).' },
  { eventCode: 'SUBSTITUTION', channel: 'IN_APP', language: 'kn', subject: 'ಬದಲಿ ತರಗತಿ: {{date}} ರಂದು {{section}}', body: '{{date}} ರಂದು {{period}} ನಲ್ಲಿ {{section}} ಗೆ {{subject}} ತೆಗೆದುಕೊಳ್ಳಿ ({{absent}} ಇಲ್ಲ).' },
  { eventCode: 'SUBSTITUTION', channel: 'EMAIL', language: 'en', subject: 'Substitute class: {{section}} on {{date}}', body: 'Hello,\n\nPlease take {{subject}} for {{section}} in {{period}} on {{date}}. {{absent}} is away.\n\nYour timetable in EduERP shows it.' },
  { eventCode: 'SUBSTITUTION', channel: 'EMAIL', language: 'kn', subject: 'ಬದಲಿ ತರಗತಿ: {{date}} ರಂದು {{section}}', body: 'ನಮಸ್ಕಾರ,\n\n{{date}} ರಂದು {{period}} ನಲ್ಲಿ {{section}} ಗೆ {{subject}} ತೆಗೆದುಕೊಳ್ಳಿ. {{absent}} ಇಲ್ಲ.\n\nEduERP ನಲ್ಲಿ ನಿಮ್ಮ ವೇಳಾಪಟ್ಟಿಯಲ್ಲಿ ಇದು ಕಾಣುತ್ತದೆ.' },
  { eventCode: 'HOMEWORK', channel: 'IN_APP', language: 'en', subject: 'Homework: {{subject}} — due {{dueDate}}', body: '{{title}} ({{section}})' },
  { eventCode: 'HOMEWORK', channel: 'IN_APP', language: 'kn', subject: 'ಮನೆಗೆಲಸ: {{subject}} — {{dueDate}} ಒಳಗೆ', body: '{{title}} ({{section}})' },
  { eventCode: 'HOMEWORK', channel: 'EMAIL', language: 'en', subject: 'Homework in {{subject}} — due {{dueDate}}', body: 'Dear parent,\n\nNew homework for {{section}} in {{subject}}: {{title}}.\nDue on {{dueDate}}.\n\nSee the details in the school app.' },
  { eventCode: 'HOMEWORK', channel: 'EMAIL', language: 'kn', subject: '{{subject}} ಮನೆಗೆಲಸ — {{dueDate}} ಒಳಗೆ', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{section}} ಗೆ {{subject}} ನಲ್ಲಿ ಹೊಸ ಮನೆಗೆಲಸ: {{title}}.\n{{dueDate}} ಒಳಗೆ.\n\nವಿವರಗಳನ್ನು ಶಾಲಾ ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ.' },
  { eventCode: 'DIARY_NOTE', channel: 'IN_APP', language: 'en', subject: 'Note from the class teacher', body: '{{note}}' },
  { eventCode: 'DIARY_NOTE', channel: 'IN_APP', language: 'kn', subject: 'ತರಗತಿ ಶಿಕ್ಷಕರಿಂದ ಟಿಪ್ಪಣಿ', body: '{{note}}' },
  { eventCode: 'DIARY_NOTE', channel: 'EMAIL', language: 'en', subject: 'Note from the class teacher ({{section}})', body: 'Dear parent,\n\n{{note}}\n\nPlease open the school app and tap Seen.' },
  // MEETING_INVITE, ACTION_ASSIGNED, COMPLAINT_UPDATE, COMPLAINT_ESCALATED, DEPT_REQUEST (Phase 12)
  { eventCode: 'MEETING_INVITE', channel: 'IN_APP', language: 'en', subject: 'Meeting: {{title}}', body: '{{when}} — please answer in the app.' },
  { eventCode: 'MEETING_INVITE', channel: 'IN_APP', language: 'kn', subject: 'ಸಭೆ: {{title}}', body: '{{when}} — ಆ್ಯಪ್‌ನಲ್ಲಿ ಉತ್ತರಿಸಿ.' },
  { eventCode: 'MEETING_INVITE', channel: 'EMAIL', language: 'en', subject: 'Meeting invitation: {{title}}', body: 'You are invited to {{title}} on {{when}}. Please answer in EduERP.' },
  { eventCode: 'MEETING_INVITE', channel: 'EMAIL', language: 'kn', subject: 'ಸಭೆಯ ಆಹ್ವಾನ: {{title}}', body: '{{when}} ರಂದು {{title}} ಸಭೆಗೆ ನಿಮ್ಮನ್ನು ಆಹ್ವಾನಿಸಲಾಗಿದೆ. EduERP ನಲ್ಲಿ ಉತ್ತರಿಸಿ.' },
  { eventCode: 'ACTION_ASSIGNED', channel: 'IN_APP', language: 'en', subject: 'Action item for you', body: '{{description}} — by {{due}}' },
  { eventCode: 'ACTION_ASSIGNED', channel: 'IN_APP', language: 'kn', subject: 'ನಿಮಗೆ ಕಾರ್ಯ', body: '{{description}} — {{due}} ರೊಳಗೆ' },
  { eventCode: 'COMPLAINT_UPDATE', channel: 'IN_APP', language: 'en', subject: 'Complaint {{no}}', body: '{{subject}}: {{status}}' },
  { eventCode: 'COMPLAINT_UPDATE', channel: 'IN_APP', language: 'kn', subject: 'ದೂರು {{no}}', body: '{{subject}}: {{status}}' },
  { eventCode: 'COMPLAINT_UPDATE', channel: 'EMAIL', language: 'en', subject: 'Update on your complaint {{no}}', body: 'Your complaint "{{subject}}" is now: {{status}}. Open the school app for details.' },
  { eventCode: 'COMPLAINT_UPDATE', channel: 'EMAIL', language: 'kn', subject: 'ನಿಮ್ಮ ದೂರು {{no}} ಕುರಿತು', body: 'ನಿಮ್ಮ ದೂರು "{{subject}}" ಈಗ: {{status}}. ವಿವರಗಳಿಗೆ ಶಾಲಾ ಆ್ಯಪ್ ತೆರೆಯಿರಿ.' },
  { eventCode: 'COMPLAINT_ESCALATED', channel: 'IN_APP', language: 'en', subject: 'Overdue complaint {{no}}', body: '{{subject}} has passed its time to resolve.' },
  { eventCode: 'COMPLAINT_ESCALATED', channel: 'IN_APP', language: 'kn', subject: 'ಬಾಕಿ ದೂರು {{no}}', body: '{{subject}} ಪರಿಹಾರದ ಸಮಯ ಮೀರಿದೆ.' },
  { eventCode: 'COMPLAINT_ESCALATED', channel: 'EMAIL', language: 'en', subject: 'Overdue complaint {{no}}', body: 'The complaint "{{subject}}" has passed its time to resolve. Please look at it in EduERP.' },
  { eventCode: 'COMPLAINT_ESCALATED', channel: 'EMAIL', language: 'kn', subject: 'ಬಾಕಿ ದೂರು {{no}}', body: '"{{subject}}" ದೂರಿನ ಪರಿಹಾರದ ಸಮಯ ಮೀರಿದೆ. EduERP ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.' },
  { eventCode: 'DEPT_REQUEST', channel: 'IN_APP', language: 'en', subject: 'Request {{no}}', body: '{{title}}: {{status}}' },
  { eventCode: 'DEPT_REQUEST', channel: 'IN_APP', language: 'kn', subject: 'ಕೋರಿಕೆ {{no}}', body: '{{title}}: {{status}}' },
  // FEED_POST, EVENT_INVITE, PTM_BOOKED (Phase 11)
  { eventCode: 'FEED_POST', channel: 'IN_APP', language: 'en', subject: 'School news', body: '{{title}}' },
  { eventCode: 'FEED_POST', channel: 'IN_APP', language: 'kn', subject: 'ಶಾಲಾ ಸುದ್ದಿ', body: '{{title}}' },
  { eventCode: 'EVENT_INVITE', channel: 'IN_APP', language: 'en', subject: 'New event: {{title}}', body: '{{title}} on {{date}} — please reply for {{student}} in the app.' },
  { eventCode: 'EVENT_INVITE', channel: 'IN_APP', language: 'kn', subject: 'ಹೊಸ ಕಾರ್ಯಕ್ರಮ: {{title}}', body: '{{date}} ರಂದು {{title}} — {{student}} ಪರವಾಗಿ ಆ್ಯಪ್‌ನಲ್ಲಿ ಉತ್ತರಿಸಿ.' },
  { eventCode: 'EVENT_INVITE', channel: 'EMAIL', language: 'en', subject: 'New school event: {{title}}', body: 'Dear parent,\n\n{{title}} is on {{date}}. Please open the school app to reply for {{student}}.' },
  { eventCode: 'EVENT_INVITE', channel: 'EMAIL', language: 'kn', subject: 'ಹೊಸ ಶಾಲಾ ಕಾರ್ಯಕ್ರಮ: {{title}}', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{date}} ರಂದು {{title}} ಇದೆ. {{student}} ಪರವಾಗಿ ಉತ್ತರಿಸಲು ಶಾಲಾ ಆ್ಯಪ್ ತೆರೆಯಿರಿ.' },
  { eventCode: 'PTM_BOOKED', channel: 'IN_APP', language: 'en', subject: 'Meeting booked', body: '{{student}}: meeting with {{teacher}} on {{date}} at {{time}}.' },
  { eventCode: 'PTM_BOOKED', channel: 'IN_APP', language: 'kn', subject: 'ಸಭೆ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ', body: '{{student}}: {{date}} ರಂದು {{time}} ಕ್ಕೆ {{teacher}} ಅವರೊಂದಿಗೆ ಸಭೆ.' },
  // RESULT_PUBLISHED (Phase 9)
  { eventCode: 'RESULT_PUBLISHED', channel: 'IN_APP', language: 'en', subject: 'Results published', body: '{{student}}’s {{term}} results are ready in the app.' },
  { eventCode: 'RESULT_PUBLISHED', channel: 'IN_APP', language: 'kn', subject: 'ಫಲಿತಾಂಶ ಪ್ರಕಟವಾಗಿದೆ', body: '{{student}} ಅವರ {{term}} ಫಲಿತಾಂಶ ಆ್ಯಪ್‌ನಲ್ಲಿ ಲಭ್ಯವಿದೆ.' },
  { eventCode: 'RESULT_PUBLISHED', channel: 'EMAIL', language: 'en', subject: '{{student}}: {{term}} results', body: 'Dear parent,\n\n{{student}}’s {{term}} results ({{section}}) are published. Open the school app to see the report card.' },
  { eventCode: 'RESULT_PUBLISHED', channel: 'EMAIL', language: 'kn', subject: '{{student}}: {{term}} ಫಲಿತಾಂಶ', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{student}} ಅವರ {{term}} ಫಲಿತಾಂಶ ({{section}}) ಪ್ರಕಟವಾಗಿದೆ. ಪ್ರಗತಿ ಪತ್ರ ನೋಡಲು ಶಾಲಾ ಆ್ಯಪ್ ತೆರೆಯಿರಿ.' },
  { eventCode: 'DIARY_NOTE', channel: 'EMAIL', language: 'kn', subject: 'ತರಗತಿ ಶಿಕ್ಷಕರಿಂದ ಟಿಪ್ಪಣಿ ({{section}})', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{note}}\n\nದಯವಿಟ್ಟು ಶಾಲಾ ಆ್ಯಪ್ ತೆರೆದು ನೋಡಿದೆ ಒತ್ತಿ.' },
  // HOSTEL_ABSENT, HOSTEL_OUTPASS (Phase 7)
  { eventCode: 'HOSTEL_ABSENT', channel: 'IN_APP', language: 'en', subject: '{{student}} was absent at roll-call', body: '{{student}} was not in {{hostel}} at the night roll-call on {{date}}. Please contact the warden.' },
  { eventCode: 'HOSTEL_ABSENT', channel: 'IN_APP', language: 'kn', subject: 'ರಾತ್ರಿ ಹಾಜರಿಯಲ್ಲಿ {{student}} ಗೈರು', body: '{{date}} ರ ರಾತ್ರಿ ಹಾಜರಿಯಲ್ಲಿ {{student}} {{hostel}} ನಲ್ಲಿ ಇರಲಿಲ್ಲ. ದಯವಿಟ್ಟು ವಾರ್ಡನ್ ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.' },
  { eventCode: 'HOSTEL_ABSENT', channel: 'EMAIL', language: 'en', subject: '{{student}} was absent at the hostel roll-call', body: 'Dear parent,\n\n{{student}} was not in {{hostel}} at the night roll-call on {{date}}.\n\nPlease contact the hostel warden.' },
  { eventCode: 'HOSTEL_ABSENT', channel: 'EMAIL', language: 'kn', subject: 'ಹಾಸ್ಟೆಲ್ ರಾತ್ರಿ ಹಾಜರಿಯಲ್ಲಿ {{student}} ಗೈರು', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{date}} ರ ರಾತ್ರಿ ಹಾಜರಿಯಲ್ಲಿ {{student}} {{hostel}} ನಲ್ಲಿ ಇರಲಿಲ್ಲ.\n\nದಯವಿಟ್ಟು ಹಾಸ್ಟೆಲ್ ವಾರ್ಡನ್ ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.' },
  { eventCode: 'HOSTEL_OUTPASS', channel: 'IN_APP', language: 'en', subject: 'Outpass for {{student}}: please approve', body: '{{student}} asks to go to {{destination}} from {{outTime}} to {{expectedReturn}}. Approve or refuse in the app.' },
  { eventCode: 'HOSTEL_OUTPASS', channel: 'IN_APP', language: 'kn', subject: '{{student}} ಗೆ ಹೊರಹೋಗುವ ಅನುಮತಿ: ದಯವಿಟ್ಟು ಅನುಮೋದಿಸಿ', body: '{{student}} {{outTime}} ರಿಂದ {{expectedReturn}} ವರೆಗೆ {{destination}} ಗೆ ಹೋಗಲು ಕೇಳುತ್ತಿದ್ದಾರೆ. ಆ್ಯಪ್‌ನಲ್ಲಿ ಅನುಮೋದಿಸಿ ಅಥವಾ ನಿರಾಕರಿಸಿ.' },
  { eventCode: 'HOSTEL_OUTPASS', channel: 'EMAIL', language: 'en', subject: 'Outpass for {{student}} needs your approval', body: 'Dear parent,\n\n{{student}} asks to go to {{destination}} from {{outTime}} to {{expectedReturn}}.\n\nPlease sign in to the school app to approve or refuse.' },
  { eventCode: 'HOSTEL_OUTPASS', channel: 'EMAIL', language: 'kn', subject: '{{student}} ಹೊರಹೋಗುವ ಅನುಮತಿಗೆ ನಿಮ್ಮ ಅನುಮೋದನೆ ಬೇಕು', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{student}} {{outTime}} ರಿಂದ {{expectedReturn}} ವರೆಗೆ {{destination}} ಗೆ ಹೋಗಲು ಕೇಳುತ್ತಿದ್ದಾರೆ.\n\nಅನುಮೋದಿಸಲು ಅಥವಾ ನಿರಾಕರಿಸಲು ಶಾಲಾ ಆ್ಯಪ್‌ಗೆ ಲಾಗಿನ್ ಮಾಡಿ.' },
  // TRANSPORT_EXPIRY (Phase 6)
  { eventCode: 'TRANSPORT_EXPIRY', channel: 'IN_APP', language: 'en', subject: '{{what}} expires in {{days}} days', body: '{{what}} of {{whose}} expires on {{validTo}}. Renew it and add the new one in Transport.' },
  { eventCode: 'TRANSPORT_EXPIRY', channel: 'IN_APP', language: 'kn', subject: '{{what}} {{days}} ದಿನಗಳಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ', body: '{{whose}} ಅವರ {{what}} {{validTo}} ರಂದು ಮುಗಿಯುತ್ತದೆ. ನವೀಕರಿಸಿ, ಹೊಸದನ್ನು ಸಾರಿಗೆ ವಿಭಾಗದಲ್ಲಿ ಸೇರಿಸಿ.' },
  { eventCode: 'TRANSPORT_EXPIRY', channel: 'EMAIL', language: 'en', subject: '{{what}} of {{whose}} expires in {{days}} days', body: 'Hello,\n\n{{what}} of {{whose}} expires on {{validTo}} ({{days}} days from today).\n\nPlease renew it and add the new document in EduERP → Transport.' },
  { eventCode: 'TRANSPORT_EXPIRY', channel: 'EMAIL', language: 'kn', subject: '{{whose}} ಅವರ {{what}} {{days}} ದಿನಗಳಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ', body: 'ನಮಸ್ಕಾರ,\n\n{{whose}} ಅವರ {{what}} {{validTo}} ರಂದು ಮುಗಿಯುತ್ತದೆ (ಇಂದಿನಿಂದ {{days}} ದಿನ).\n\nದಯವಿಟ್ಟು ನವೀಕರಿಸಿ, ಹೊಸ ದಾಖಲೆಯನ್ನು EduERP → ಸಾರಿಗೆ ಯಲ್ಲಿ ಸೇರಿಸಿ.' },
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
  // LIBRARY_OVERDUE, LIBRARY_READY, INFIRMARY_VISIT, DISCIPLINE_INCIDENT (Phase 16)
  { eventCode: 'LIBRARY_OVERDUE', channel: 'IN_APP', language: 'en', subject: 'Library book overdue: {{title}}', body: '{{who}} had "{{title}}" due back on {{dueDate}} ({{days}} days late). Please return it to the library.' },
  { eventCode: 'LIBRARY_OVERDUE', channel: 'IN_APP', language: 'kn', subject: 'ಗ್ರಂಥಾಲಯ ಪುಸ್ತಕ ತಡ: {{title}}', body: '{{who}} ಅವರ "{{title}}" {{dueDate}} ರಂದು ಹಿಂದಿರುಗಿಸಬೇಕಿತ್ತು ({{days}} ದಿನ ತಡ). ದಯವಿಟ್ಟು ಗ್ರಂಥಾಲಯಕ್ಕೆ ಹಿಂದಿರುಗಿಸಿ.' },
  { eventCode: 'LIBRARY_OVERDUE', channel: 'EMAIL', language: 'en', subject: 'Library book overdue: {{title}}', body: 'Hello,\n\n{{who}} had "{{title}}" due back on {{dueDate}} — it is now {{days}} days late.\n\nPlease return it to the library.' },
  { eventCode: 'LIBRARY_OVERDUE', channel: 'EMAIL', language: 'kn', subject: 'ಗ್ರಂಥಾಲಯ ಪುಸ್ತಕ ತಡ: {{title}}', body: 'ನಮಸ್ಕಾರ,\n\n{{who}} ಅವರ "{{title}}" {{dueDate}} ರಂದು ಹಿಂದಿರುಗಿಸಬೇಕಿತ್ತು — ಈಗ {{days}} ದಿನ ತಡವಾಗಿದೆ.\n\nದಯವಿಟ್ಟು ಗ್ರಂಥಾಲಯಕ್ಕೆ ಹಿಂದಿರುಗಿಸಿ.' },
  { eventCode: 'LIBRARY_READY', channel: 'IN_APP', language: 'en', subject: 'Your reserved book is ready', body: '"{{title}}" is kept for {{who}} at the library until {{until}}.' },
  { eventCode: 'LIBRARY_READY', channel: 'IN_APP', language: 'kn', subject: 'ಕಾಯ್ದಿರಿಸಿದ ಪುಸ್ತಕ ಸಿದ್ಧ', body: '"{{title}}" ಅನ್ನು {{who}} ಅವರಿಗಾಗಿ {{until}} ವರೆಗೆ ಗ್ರಂಥಾಲಯದಲ್ಲಿ ಇಡಲಾಗಿದೆ.' },
  { eventCode: 'LIBRARY_READY', channel: 'EMAIL', language: 'en', subject: 'Reserved book ready: {{title}}', body: 'Hello,\n\n"{{title}}" is now kept for {{who}} at the library until {{until}}. Please collect it before then.' },
  { eventCode: 'LIBRARY_READY', channel: 'EMAIL', language: 'kn', subject: 'ಕಾಯ್ದಿರಿಸಿದ ಪುಸ್ತಕ ಸಿದ್ಧ: {{title}}', body: 'ನಮಸ್ಕಾರ,\n\n"{{title}}" ಅನ್ನು {{who}} ಅವರಿಗಾಗಿ {{until}} ವರೆಗೆ ಗ್ರಂಥಾಲಯದಲ್ಲಿ ಇಡಲಾಗಿದೆ. ಅದರೊಳಗೆ ಪಡೆದುಕೊಳ್ಳಿ.' },
  { eventCode: 'INFIRMARY_VISIT', channel: 'IN_APP', language: 'en', subject: '{{student}} was seen by the school nurse', body: '{{time}}: {{complaint}}. {{outcome}}' },
  { eventCode: 'INFIRMARY_VISIT', channel: 'IN_APP', language: 'kn', subject: '{{student}} ಅವರನ್ನು ಶಾಲಾ ನರ್ಸ್ ನೋಡಿದ್ದಾರೆ', body: '{{time}}: {{complaint}}. {{outcome}}' },
  { eventCode: 'INFIRMARY_VISIT', channel: 'EMAIL', language: 'en', subject: '{{student}} was seen by the school nurse', body: 'Dear parent,\n\n{{student}} was seen in the school infirmary at {{time}} for: {{complaint}}.\n\n{{outcome}}\n\nPlease contact the school if you have any questions.' },
  { eventCode: 'INFIRMARY_VISIT', channel: 'EMAIL', language: 'kn', subject: '{{student}} ಅವರನ್ನು ಶಾಲಾ ನರ್ಸ್ ನೋಡಿದ್ದಾರೆ', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{time}} ಕ್ಕೆ {{student}} ಅವರನ್ನು ಶಾಲಾ ಆರೋಗ್ಯ ಕೊಠಡಿಯಲ್ಲಿ ನೋಡಲಾಯಿತು: {{complaint}}.\n\n{{outcome}}\n\nಪ್ರಶ್ನೆಗಳಿದ್ದರೆ ಶಾಲೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.' },
  { eventCode: 'DISCIPLINE_INCIDENT', channel: 'IN_APP', language: 'en', subject: 'Behaviour note about {{student}}', body: 'An incident ({{type}}) was recorded on {{date}}. The class teacher will be in touch; you can also contact the school.' },
  { eventCode: 'DISCIPLINE_INCIDENT', channel: 'IN_APP', language: 'kn', subject: '{{student}} ಅವರ ನಡವಳಿಕೆ ಕುರಿತು', body: '{{date}} ರಂದು ಒಂದು ಘಟನೆ ({{type}}) ದಾಖಲಾಗಿದೆ. ತರಗತಿ ಶಿಕ್ಷಕರು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ; ನೀವೂ ಶಾಲೆಯನ್ನು ಸಂಪರ್ಕಿಸಬಹುದು.' },
  { eventCode: 'DISCIPLINE_INCIDENT', channel: 'EMAIL', language: 'en', subject: 'Behaviour note about {{student}}', body: 'Dear parent,\n\nAn incident ({{type}}) involving {{student}} was recorded on {{date}}.\n\nThe class teacher will be in touch. You are welcome to contact the school.' },
  { eventCode: 'DISCIPLINE_INCIDENT', channel: 'EMAIL', language: 'kn', subject: '{{student}} ಅವರ ನಡವಳಿಕೆ ಕುರಿತು', body: 'ಆತ್ಮೀಯ ಪೋಷಕರೇ,\n\n{{date}} ರಂದು {{student}} ಅವರನ್ನು ಒಳಗೊಂಡ ಒಂದು ಘಟನೆ ({{type}}) ದಾಖಲಾಗಿದೆ.\n\nತರಗತಿ ಶಿಕ್ಷಕರು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. ನೀವು ಶಾಲೆಯನ್ನು ಸಂಪರ್ಕಿಸಬಹುದು.' },
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
