import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { ResetPasswordInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { OutboxService } from '../../common/outbox.service';
import { AppError } from '../../common/problem';
import { config } from '../../config';

export const ACCOUNT_EVENTS = { PASSWORD_RESET: 'auth.password_reset', INVITE: 'auth.invite' } as const;
export const RESET_TTL_MINUTES = 60;
export const INVITE_TTL_DAYS = 7;
const RESETS_PER_HOUR = 3;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const linkInvalid = () => new AppError(HttpStatus.BAD_REQUEST, 'link-invalid', 'This link has expired or was already used. Ask for a new one.');

/**
 * One-time account links (invite → set password, forgot password → reset).
 * The API only records the request in the outbox; the worker creates the token and emails it,
 * so the raw token exists only in the email. Only its SHA-256 is stored.
 */
@Injectable()
export class AccountLinksService {
  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxService,
  ) {}

  /** Always succeeds from the caller's point of view, so it cannot be used to find out which emails exist. */
  async requestReset(email: string): Promise<void> {
    await this.db.run({ loginIdentifier: email }, async (tx) => {
      const user = await tx.user.findUnique({ where: { email }, select: { id: true, status: true } });
      if (!user || user.status === 'DISABLED') return;
      const recent = await tx.authToken.count({ where: { userId: user.id, purpose: 'RESET', createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
      if (recent >= RESETS_PER_HOUR) return; // quietly rate-limited
      await this.outbox.add(tx, { tenantId: null, eventType: ACCOUNT_EVENTS.PASSWORD_RESET, aggregateType: 'USER', aggregateId: user.id, payload: { userId: user.id } });
    });
  }

  /** Called by the invite flow inside its transaction. */
  async queueInvite(tx: Tx, tenantId: string, userId: string, invitedBy: string): Promise<void> {
    await this.outbox.add(tx, { tenantId, eventType: ACCOUNT_EVENTS.INVITE, aggregateType: 'USER', aggregateId: userId, payload: { userId, invitedBy } });
  }

  /** Validates a link without using it (so the page can show "expired" before the user types a password). */
  async check(token: string): Promise<{ purpose: string; email: string | null; name: string }> {
    const row = await this.db.run({}, (tx) =>
      tx.authToken.findUnique({ where: { tokenHash: sha256(token) }, select: { purpose: true, usedAt: true, expiresAt: true, userId: true } }),
    );
    if (!row || row.usedAt || row.expiresAt <= new Date()) throw linkInvalid();
    const user = await this.db.run({ userId: row.userId }, (tx) => tx.user.findUnique({ where: { id: row.userId }, select: { email: true, fullName: true } }));
    return { purpose: row.purpose, email: user?.email ?? null, name: user?.fullName ?? '' };
  }

  /** Sets the password, uses the link up, signs out every session and clears any lockout. */
  async reset(input: ResetPasswordInput): Promise<{ ok: true }> {
    const tokenHash = sha256(input.token);
    const found = await this.db.run({}, (tx) => tx.authToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, purpose: true, usedAt: true, expiresAt: true } }));
    if (!found || found.usedAt || found.expiresAt <= new Date()) throw linkInvalid();
    const passwordHash = await hash(input.password);
    await this.db.run({ userId: found.userId }, async (tx) => {
      // Claim the link atomically: only one request can use it.
      const claimed = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!claimed.count) throw linkInvalid();
      await tx.authToken.updateMany({ where: { userId: found.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: found.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' } });
      await tx.refreshToken.updateMany({ where: { userId: found.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { ok: true };
  }

  /** Worker side: creates a fresh token (older unused ones stop working) and returns the link. */
  static async issue(tx: Tx, userId: string, tenantId: string | null, purpose: 'RESET' | 'INVITE'): Promise<string> {
    await tx.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    const raw = randomBytes(32).toString('base64url');
    const ttl = purpose === 'RESET' ? RESET_TTL_MINUTES * 60_000 : INVITE_TTL_DAYS * 86_400_000;
    await tx.authToken.create({ data: { userId, tenantId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttl) } });
    return `${config().WEB_ORIGIN}/reset-password?token=${raw}${purpose === 'INVITE' ? '&invite=1' : ''}`;
  }
}
