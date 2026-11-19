import { z } from 'zod';

/**
 * Settings registry (G-11). Every setting an institution can change is declared here, once:
 * its value schema, default, and where it may be set. The API rejects unknown keys and invalid
 * values; the web settings screen is generated from the same list.
 *
 * Resolution order for the effective value: campus override → institution value → default.
 */
export type SettingScope = 'TENANT' | 'CAMPUS';

export interface SettingDefinition<T = unknown> {
  key: string;
  label: string;
  description: string;
  group: 'General' | 'Attendance' | 'Fees' | 'Notifications' | 'Files' | 'Engagement' | 'Accounts';
  schema: z.ZodType<T>;
  defaultValue: T;
  /** Where it may be set. TENANT = institution-wide value; CAMPUS = per-campus override allowed. */
  scopes: SettingScope[];
  /** Fixed choices (shown as a dropdown). */
  options?: { value: string; label: string }[];
}

const define = <T>(d: SettingDefinition<T>) => d;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const SETTINGS = [
  define({
    key: 'general.academic_year_start_month',
    label: 'Academic year starts in',
    description: 'Month number (1 = January). Used to suggest academic-year names and dates.',
    group: 'General',
    schema: z.number().int().min(1).max(12),
    defaultValue: 6,
    scopes: ['TENANT'],
  }),
  define({
    key: 'general.default_language',
    label: 'Default language',
    description: 'Language for printouts and for users who have not chosen one.',
    group: 'General',
    schema: z.enum(['en', 'kn']),
    defaultValue: 'en' as 'en' | 'kn',
    scopes: ['TENANT', 'CAMPUS'],
  }),
  define({
    key: 'attendance.mode',
    label: 'How attendance is taken',
    description: 'Daily: one mark per student per day. Period-wise: a mark in every period (usual in PU and degree colleges).',
    group: 'Attendance',
    schema: z.enum(['DAILY', 'PERIOD']),
    defaultValue: 'DAILY' as 'DAILY' | 'PERIOD',
    scopes: ['TENANT', 'CAMPUS'],
    options: [{ value: 'DAILY', label: 'Daily' }, { value: 'PERIOD', label: 'Period-wise' }],
  }),
  define({
    key: 'attendance.weekly_off',
    label: 'Weekly holidays',
    description: 'Days on which attendance is not taken (in addition to the holiday list).',
    group: 'Attendance',
    schema: z.enum(['SUN', 'SUN_2ND_4TH_SAT', 'SAT_SUN', 'NONE']),
    defaultValue: 'SUN' as 'SUN' | 'SUN_2ND_4TH_SAT' | 'SAT_SUN' | 'NONE',
    scopes: ['TENANT', 'CAMPUS'],
    options: [
      { value: 'SUN', label: 'Sundays' },
      { value: 'SUN_2ND_4TH_SAT', label: 'Sundays and 2nd & 4th Saturdays' },
      { value: 'SAT_SUN', label: 'Saturdays and Sundays' },
      { value: 'NONE', label: 'None' },
    ],
  }),
  define({
    key: 'attendance.absent_alerts',
    label: 'Tell parents when a child is absent',
    description: 'When attendance is submitted, the main contact of each absent student gets one message for the day (email now; SMS / WhatsApp when set up).',
    group: 'Attendance',
    schema: z.enum(['ON', 'OFF']),
    defaultValue: 'ON' as 'ON' | 'OFF',
    scopes: ['TENANT', 'CAMPUS'],
    options: [{ value: 'ON', label: 'Yes' }, { value: 'OFF', label: 'No' }],
  }),
  define({
    key: 'attendance.min_percent',
    label: 'Minimum attendance (%)',
    description: 'Students below this percentage are listed in the attendance reports (e.g. 75 for exam eligibility).',
    group: 'Attendance',
    schema: z.number().int().min(1).max(100),
    defaultValue: 75,
    scopes: ['TENANT', 'CAMPUS'],
  }),
  define({
    key: 'attendance.late_after_minutes',
    label: 'Mark late after (minutes)',
    description: 'Arrivals later than this many minutes after the first period are marked late.',
    group: 'Attendance',
    schema: z.number().int().min(0).max(240),
    defaultValue: 10,
    scopes: ['TENANT', 'CAMPUS'],
  }),
  define({
    key: 'fees.receipt_footer',
    label: 'Receipt footer',
    description: 'Text printed at the bottom of every fee receipt.',
    group: 'Fees',
    schema: z.string().trim().max(300),
    defaultValue: '',
    scopes: ['TENANT', 'CAMPUS'],
  }),
  define({
    key: 'notifications.quiet_hours',
    label: 'Quiet hours',
    description: 'SMS and WhatsApp messages that are not urgent are held during these hours.',
    group: 'Notifications',
    schema: z.object({ start: hhmm, end: hhmm }).nullable(),
    defaultValue: { start: '21:00', end: '07:00' } as { start: string; end: string } | null,
    scopes: ['TENANT'],
  }),
  define({
    key: 'files.max_upload_mb',
    label: 'Largest upload (MB)',
    description: 'Maximum size of a single uploaded document.',
    group: 'Files',
    schema: z.number().int().min(1).max(25),
    defaultValue: 10,
    scopes: ['TENANT'],
  }),
  define({
    key: 'feed.teacher_posts_need_approval',
    label: 'Teachers’ news posts need approval',
    description: 'Posts by staff who cannot moderate the feed wait until a moderator approves them.',
    group: 'Engagement',
    schema: z.enum(['ON', 'OFF']),
    defaultValue: 'ON' as 'ON' | 'OFF',
    scopes: ['TENANT', 'CAMPUS'],
    options: [{ value: 'ON', label: 'Yes' }, { value: 'OFF', label: 'No' }],
  }),
  define({
    key: 'accounts.statutory_rates_confirmed',
    label: 'GST and TDS rates checked by the accountant',
    description: 'EduERP fills in commonly used rates; until the accountant confirms them, Accounts shows a reminder to check them.',
    group: 'Accounts',
    schema: z.enum(['NO', 'YES']),
    defaultValue: 'NO' as 'NO' | 'YES',
    scopes: ['TENANT'],
    options: [{ value: 'NO', label: 'Not yet' }, { value: 'YES', label: 'Yes' }],
  }),
] as const;

export type SettingKey = (typeof SETTINGS)[number]['key'];
export const SETTINGS_BY_KEY: Record<string, SettingDefinition> = Object.fromEntries(SETTINGS.map((s) => [s.key, s as SettingDefinition]));

/** Body of PUT /settings/:key. `value` is checked against the registry schema of that key. */
export const putSettingSchema = z.object({
  campusId: z.string().uuid().nullable().optional(),
  value: z.unknown(),
});
export type PutSettingInput = z.infer<typeof putSettingSchema>;

export const settingsQuerySchema = z.object({ campusId: z.string().uuid().optional() });
