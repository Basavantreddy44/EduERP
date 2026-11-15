import type { ZodTypeAny } from 'zod';
import { ApiError } from './api';

export type FieldErrors = Record<string, string>;

/** Validates with the same shared Zod schema the API uses. Returns data or per-field errors. */
export function validate<S extends ZodTypeAny>(schema: S, values: unknown):
  | { ok: true; data: ReturnType<S['parse']> }
  | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(values);
  if (r.success) return { ok: true, data: r.data };
  const errors: FieldErrors = {};
  for (const i of r.error.issues) errors[i.path.join('.')] ??= i.message;
  return { ok: false, errors };
}

/** Maps an API 422 back onto form fields; other errors become a form-level message. */
export function apiErrors(e: unknown): { fields: FieldErrors; message: string | null } {
  if (e instanceof ApiError) {
    const fields: FieldErrors = {};
    for (const f of e.errors ?? []) fields[f.field] ??= f.message;
    return { fields, message: Object.keys(fields).length ? null : e.message };
  }
  return { fields: {}, message: 'Something unexpected happened. Please try again.' };
}

/** Empty strings from inputs become undefined so optional fields validate. */
export function clean<T extends Record<string, string>>(v: T): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() === '' ? undefined : x]));
}
