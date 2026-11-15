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
  group: 'General' | 'Attendance' | 'Fees' | 'Notifications' | 'Files';
  schema: z.ZodType<T>;
  defaultValue: T;
  /** Where it may be set. TENANT = institution-wide value; CAMPUS = per-campus override allowed. */
  scopes: SettingScope[];
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
