import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';

/**
 * Field-level encryption for bank account numbers and PAN (CD-84). AES-256-GCM with a key held only in
 * the server environment. A stored value looks like `v1:<iv>:<tag>:<ciphertext>` (base64url); the
 * version lets the key be rotated or moved to a cloud key service later without changing tables. Screens
 * get only the last 4 characters (kept in a separate column); the full value is decrypted only for an
 * audited "show" or for files such as bank transfers.
 *
 * Key: FIELD_ENCRYPTION_KEY = 32 random bytes in base64. Required in production. Outside production,
 * when it is missing, a key is derived from JWT_ACCESS_SECRET so development and tests work; data
 * written that way must not be carried into production.
 */
const VERSION = 'v1';
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const c = config();
  const raw = c.FIELD_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes in base64 (for example: openssl rand -base64 32)');
    cachedKey = k;
  } else if (c.NODE_ENV === 'production') {
    throw new Error('FIELD_ENCRYPTION_KEY is not set — bank account numbers and PAN cannot be stored');
  } else {
    cachedKey = createHash('sha256').update(`eduerp-dev-field-key:${c.JWT_ACCESS_SECRET}`).digest();
  }
  return cachedKey;
}

const b64 = (b: Buffer) => b.toString('base64url');

/** Encrypts a value; empty / null stays null. */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${VERSION}:${b64(iv)}:${b64(c.getAuthTag())}:${b64(enc)}`;
}

/** Decrypts a stored value (throws if it was changed or the key is wrong). */
export function decryptField(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, data] = stored.split(':');
  if (v !== VERSION || !iv || !tag || !data) throw new Error('Unknown encrypted value format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

/** Last 4 characters shown on screens ("••••1234"). */
export const last4 = (plain: string | null | undefined) => (plain ? plain.replace(/\s/g, '').slice(-4) : null);
export const masked = (l4: string | null | undefined) => (l4 ? `••••${l4}` : null);

/** For tests only: forget the cached key (after changing the environment). */
export function resetFieldKeyForTests() { cachedKey = null; }
