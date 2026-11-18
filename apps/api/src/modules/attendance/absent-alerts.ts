import type { Tx } from '../../common/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SettingsService } from '../settings/settings.service';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface AlertResult { alerted: number; noEmail: number; alreadyTold: number; skipped: 'not-today' | 'switched-off' | null }

/**
 * Absent alerts (M3.3): one message per student per day to the main contact, only for today's
 * attendance (a sheet for an earlier day never messages parents). Email until an SMS / WhatsApp
 * provider is chosen (DEC-09). Every record of the student that day is marked as notified.
 */
export async function alertAbsentees(
  tx: Tx,
  deps: { notifications: NotificationsService; settings: SettingsService },
  a: { tenantId: string; campusId: string; date: string; studentIds: string[]; senderUserId: string; className: string; periodName?: string | null },
): Promise<AlertResult> {
  const r: AlertResult = { alerted: 0, noEmail: 0, alreadyTold: 0, skipped: null };
  if (!a.studentIds.length) return r;
  if (a.date !== todayIST()) return { ...r, skipped: 'not-today' };
  if ((await deps.settings.effective<string>(tx, 'attendance.absent_alerts', a.campusId)) !== 'ON') return { ...r, skipped: 'switched-off' };
  const day = new Date(`${a.date}T00:00:00.000Z`);
  const told = new Set((await tx.attendanceRecord.findMany({ where: { studentId: { in: a.studentIds }, attendanceDate: day, parentNotified: true }, select: { studentId: true } })).map((x) => x.studentId));
  const tenant = await tx.tenant.findUnique({ where: { id: a.tenantId }, select: { name: true } });
  const school = tenant?.name ?? 'School';
  for (const studentId of a.studentIds) {
    if (told.has(studentId)) { r.alreadyTold += 1; continue; }
    const s = await tx.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true, email: true } } } } } });
    const main = s?.guardians[0]?.guardian;
    if (!s || !main?.email) { r.noEmail += 1; continue; }
    const name = `${s.firstName} ${s.lastName ?? ''}`.trim();
    const when = `${longDate(a.date)}${a.periodName ? ` (${a.periodName})` : ''}`;
    await deps.notifications.emailExternal(tx, {
      tenantId: a.tenantId, senderUserId: a.senderUserId, to: main.email, eventCode: 'ATTENDANCE_ABSENT', entityType: 'STUDENT', entityId: studentId,
      subject: `${name} was absent today — ${school}`,
      body: [
        `Dear ${main.name},`,
        '',
        `${name} (${a.className}) was marked absent on ${when}.`,
        'If your child is unwell or this is not right, please inform the class teacher.',
        '',
        `— ${school}`,
        '',
        `ಪ್ರಿಯ ಪೋಷಕರೇ, ${name} (${a.className}) ಅವರು ${a.date} ರಂದು ಗೈರುಹಾಜರಾಗಿದ್ದಾರೆ ಎಂದು ದಾಖಲಾಗಿದೆ. ಮಗು ಅಸ್ವಸ್ಥರಾಗಿದ್ದರೆ ಅಥವಾ ಇದು ತಪ್ಪಾಗಿದ್ದರೆ ದಯವಿಟ್ಟು ತರಗತಿ ಶಿಕ್ಷಕರಿಗೆ ತಿಳಿಸಿ.`,
      ].join('\n'),
    });
    await tx.attendanceRecord.updateMany({ where: { studentId, attendanceDate: day }, data: { parentNotified: true } });
    r.alerted += 1;
  }
  return r;
}
