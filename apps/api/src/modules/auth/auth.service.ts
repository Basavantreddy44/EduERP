import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { LoginInput } from '@eduerp/shared';
import { config } from '../../config';
import { Db, Tx } from '../../common/prisma.service';
import { Forbidden, Unauthorized } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

export interface Membership {
  tenantId: string;
  name: string;
  slug: string;
  status: string;
}

export interface SessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string; // set as httpOnly cookie by the controller, never returned in the body
  tenantId: string | null;
  user: { id: string; fullName: string; platformRole: string | null; preferredLanguage: string };
  memberships: Membership[];
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
// Verifying against a dummy hash for unknown users keeps response time similar (no user enumeration).
let dummyHash: Promise<string> | undefined;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async login(input: LoginInput, client: ClientInfo): Promise<SessionResult> {
    const identifier = input.identifier.trim().toLowerCase();
    const cfg = config();

    const outcome = await this.db.run({ loginIdentifier: identifier }, async (tx) => {
      const user = await tx.user.findFirst({ where: { OR: [{ email: identifier }, { phone: identifier }] } });
      const fail = async (reason: string, userId: string | null) => {
        await tx.loginHistory.create({
          data: { userId, identifier, success: false, failureReason: reason, ipAddress: client.ip, userAgent: client.userAgent },
        });
        return { ok: false as const, reason };
      };

      if (!user || !user.passwordHash) {
        await verify((await (dummyHash ??= hash('not-a-real-password'))), input.password).catch(() => false);
        return fail('INVALID_CREDENTIALS', user?.id ?? null);
      }
      if (user.status !== 'ACTIVE') return fail('USER_' + user.status, user.id);
      if (user.lockedUntil && user.lockedUntil > new Date()) return fail('LOCKED', user.id);

      const valid = await verify(user.passwordHash, input.password).catch(() => false);
      if (!valid) {
        const failures = user.failedLoginCount + 1;
        const lock = failures >= cfg.LOGIN_MAX_FAILURES;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failures,
            lockedUntil: lock ? new Date(Date.now() + cfg.LOGIN_LOCK_MINUTES * 60_000) : user.lockedUntil,
          },
        });
        return fail('INVALID_CREDENTIALS', user.id);
      }

      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await tx.loginHistory.create({
        data: { userId: user.id, identifier, success: true, ipAddress: client.ip, userAgent: client.userAgent },
      });
      return { ok: true as const, user };
    });

    if (!outcome.ok) {
      if (outcome.reason === 'LOCKED') throw Unauthorized('account-locked', 'Too many failed attempts. Try again later.');
      throw Unauthorized('invalid-credentials', 'Incorrect login or password');
    }

    const { user } = outcome;
    const memberships = await this.memberships(user.id);
    const tenantId = memberships.length === 1 ? memberships[0].tenantId : null;
    return this.startSession(
      { id: user.id, fullName: user.fullName, platformRole: user.platformRole, preferredLanguage: user.preferredLanguage },
      tenantId,
      memberships,
      client,
      randomUUID(),
    );
  }

  /** Rotating refresh. Reusing an already-rotated token revokes the whole session family. */
  async refresh(rawToken: string | undefined, client: ClientInfo): Promise<SessionResult> {
    if (!rawToken) throw Unauthorized('refresh-missing', 'Session expired. Please log in again.');
    const tokenHash = sha256(rawToken);

    const current = await this.db.run({}, async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!row) return null;
      // Benign race: another tab/request rotated this token seconds ago. Don't punish; client retries with the new cookie.
      const graceMs = config().REFRESH_REUSE_GRACE_SECONDS * 1000;
      if (row.revokedAt && row.replacedBy && Date.now() - row.revokedAt.getTime() < graceMs) return 'stale' as const;
      if (row.revokedAt) {
        await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        return 'reused' as const;
      }
      if (row.expiresAt <= new Date()) return null;
      return row;
    });
    if (current === 'stale') throw Unauthorized('refresh-stale', 'Session was just renewed elsewhere; retry.');
    if (current === 'reused') throw Unauthorized('refresh-reused', 'Session ended for security reasons. Please log in again.');
    if (!current) throw Unauthorized('refresh-invalid', 'Session expired. Please log in again.');

    const user = await this.db.run({ userId: current.userId }, (tx) =>
      tx.user.findUnique({ where: { id: current.userId }, select: { id: true, fullName: true, platformRole: true, preferredLanguage: true, status: true } }),
    );
    if (!user || user.status !== 'ACTIVE') throw Unauthorized('session-ended', 'Session ended. Please log in again.');

    const memberships = await this.memberships(user.id);
    let tenantId = current.tenantId;
    if (tenantId && !memberships.some((m) => m.tenantId === tenantId)) tenantId = null; // membership was removed

    return this.startSession(user, tenantId, memberships, client, current.familyId, current.id);
  }

  async switchTenant(userId: string, sessionId: string, tenantId: string, client: ClientInfo): Promise<SessionResult> {
    const memberships = await this.memberships(userId);
    if (!memberships.some((m) => m.tenantId === tenantId)) throw Forbidden('membership-inactive', 'You do not have access to this institution');
    const user = await this.db.run({ userId }, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, fullName: true, platformRole: true, preferredLanguage: true } }),
    );
    await this.revokeFamily(sessionId); // old tenant-bound session ends
    return this.startSession(user, tenantId, memberships, client, randomUUID());
  }

  async logout(sessionId: string): Promise<void> {
    await this.revokeFamily(sessionId);
  }

  async memberships(userId: string): Promise<Membership[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx.userTenant.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: { not: 'CLOSED' } } },
        select: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
        orderBy: { tenant: { name: 'asc' } },
      });
      return rows.map((r) => ({ tenantId: r.tenant.id, name: r.tenant.name, slug: r.tenant.slug, status: r.tenant.status }));
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db.run({}, (tx) => tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } }));
  }

  private async startSession(
    user: { id: string; fullName: string; platformRole: string | null; preferredLanguage: string },
    tenantId: string | null,
    memberships: Membership[],
    client: ClientInfo,
    familyId: string,
    rotateFromId?: string,
  ): Promise<SessionResult> {
    const cfg = config();
    const refreshToken = randomBytes(32).toString('base64url');
    await this.db.run({}, async (tx: Tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tenantId,
          familyId,
          tokenHash: sha256(refreshToken),
          deviceInfo: client.userAgent?.slice(0, 200) ?? null,
          expiresAt: new Date(Date.now() + cfg.REFRESH_TTL_DAYS * 86_400_000),
        },
      });
      if (rotateFromId) {
        await tx.refreshToken.update({ where: { id: rotateFromId }, data: { revokedAt: new Date(), replacedBy: created.id } });
      }
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, tid: tenantId, sid: familyId },
      { algorithm: 'HS256', expiresIn: cfg.JWT_ACCESS_TTL_SECONDS },
    );
    return { accessToken, expiresIn: cfg.JWT_ACCESS_TTL_SECONDS, refreshToken, tenantId, user, memberships };
  }
}
