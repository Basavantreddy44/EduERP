import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3100'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
  LOGIN_MAX_FAILURES: z.coerce.number().int().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().default(15),
  /** Interactive API docs at /api/docs. Off in production unless explicitly enabled. */
  API_DOCS: z.enum(['on', 'off']).optional(),

  /** Owner (migration) role URL. Used only by setup scripts (jobs:setup), never by request handling. */
  DATABASE_OWNER_URL: z.string().url().optional(),

  /** Files: `local` stores under FILES_DIR (dev/test). `s3` arrives with the infra work (CD-15). */
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  FILES_DIR: z.string().default('./var/files'),

  /** Email via SMTP (Mailpit locally: localhost:1025). Without SMTP_HOST, email deliveries are marked SKIPPED. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('EduERP <no-reply@eduerp.local>'),

  /** Background jobs (pg-boss). Queue retry settings are applied by `jobs:setup`. */
  JOBS_RETRY_LIMIT: z.coerce.number().int().min(0).max(20).default(5),
  JOBS_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).max(3600).default(10),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),

  /**
   * Online payment (DEC-09 / CD-28: Razorpay). Keys live only in the environment, never in code.
   * PAYMENT_GATEWAY: razorpay (needs the three keys) · simulated (no money moves; development and
   * tests only — refused in production) · off. Default: razorpay when keys are set, else simulated
   * outside production, else off.
   */
  PAYMENT_GATEWAY: z.enum(['razorpay', 'simulated', 'off']).optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Online-payment re-check of pending orders by the worker (seconds). */
  PAYMENT_RECONCILE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/** Validated environment. Fails fast at startup with a readable message; never logs secret values. */
export function config(): AppConfig {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
