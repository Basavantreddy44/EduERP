import type { ReportFilters } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { DietService } from '../govt/diet.service';

type Cell = string | number | null;

export const MIS_COLUMNS = [
  { key: 'district', label: 'District', type: 'text' },
  { key: 'school', label: 'School', type: 'text' },
  { key: 'girls', label: 'Girls', type: 'number' },
  { key: 'boys', label: 'Boys', type: 'number' },
  { key: 'students', label: 'Students', type: 'number' },
  { key: 'joined', label: 'Joined', type: 'number' },
  { key: 'movedIn', label: 'Moved in', type: 'number' },
  { key: 'movedOut', label: 'Moved out', type: 'number' },
  { key: 'left', label: 'Left', type: 'number' },
  { key: 'attendance', label: 'Attendance %', type: 'percent' },
  { key: 'hostel', label: 'In the hostel', type: 'number' },
  { key: 'fedPerDay', label: 'Children fed per day', type: 'number' },
  { key: 'dietOff', label: 'Diet items off the scale', type: 'number' },
  { key: 'welfare', label: 'Welfare hand-outs', type: 'number' },
  { key: 'sick', label: 'Sick visits', type: 'number' },
  { key: 'checkups', label: 'Health check-ups', type: 'number' },
] as const;

const monthOf = (f: ReportFilters) => {
  const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const from = f.from ?? `${now.slice(0, 7)}-01`;
  let to = f.to;
  if (!to) {
    const e = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    e.setUTCMonth(e.getUTCMonth() + 1);
    e.setUTCDate(0);
    to = e.toISOString().slice(0, 10);
  }
  return { from, to };
};

/**
 * Monthly report by school (Phase 21 R3): for the chosen period (a month unless dates are given),
 * one row per school with its district, and a total row. A child who joined counts at the school of their first class place (even after a move). Counts come from the same records the
 * screens use: class places at the end of the period, admissions, moves, status changes, attendance,
 * hostel stays, the meal register, the diet report, welfare hand-outs, sick visits and check-ups.
 */
export async function misRows(tx: Tx, campuses: string[] | null, f: ReportFilters): Promise<Record<string, Cell>[]> {
  const { from, to } = monthOf(f);
  const list = await tx.campus.findMany({
    where: { status: 'ACTIVE', ...(f.campusId ? { id: f.campusId } : {}), ...(campuses ? { id: { in: f.campusId ? campuses.filter((c) => c === f.campusId) : campuses } } : {}) },
    orderBy: [{ district: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, district: true },
  });
  if (!list.length) return [];
  const ids = list.map((c) => c.id);
  const idArr = `{${ids.join(',')}}`;

  const roll = await tx.$queryRaw<{ campus_id: string; gender: string; n: number }[]>`
    SELECT s.campus_id, st.gender, COUNT(DISTINCT e.student_id)::int AS n
      FROM student_enrollments e JOIN sections s ON s.id = e.section_id JOIN students st ON st.id = e.student_id
     WHERE s.campus_id = ANY(${idArr}::uuid[]) AND e.enrolled_on <= ${to}::date AND (e.ended_on IS NULL OR e.ended_on > ${to}::date)
     GROUP BY s.campus_id, st.gender`;
  const joined = await tx.$queryRaw<{ campus_id: string; n: number }[]>`
    SELECT f.campus_id, COUNT(*)::int AS n FROM (
      SELECT DISTINCT ON (e.student_id) e.student_id, s.campus_id, st.admission_date FROM student_enrollments e JOIN sections s ON s.id = e.section_id JOIN students st ON st.id = e.student_id
       ORDER BY e.student_id, e.enrolled_on, e.created_at) f
     WHERE f.campus_id = ANY(${idArr}::uuid[]) AND f.admission_date BETWEEN ${from}::date AND ${to}::date GROUP BY f.campus_id`;
  const moves = await tx.campusTransfer.findMany({ where: { personType: 'STUDENT', transferDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, select: { fromCampusId: true, toCampusId: true } });
  const left = await tx.$queryRaw<{ campus_id: string; n: number }[]>`
    SELECT st.campus_id, COUNT(*)::int AS n FROM student_status_history h JOIN students st ON st.id = h.student_id
     WHERE st.campus_id = ANY(${idArr}::uuid[]) AND h.new_status IN ('DROPPED','TRANSFERRED','PASSED_OUT') AND h.effective_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY st.campus_id`;
  const att = await tx.$queryRaw<{ campus_id: string; status: string; n: number }[]>`
    SELECT ss.campus_id, r.status, COUNT(*)::int AS n FROM attendance_records r JOIN attendance_sessions ss ON ss.id = r.session_id
     WHERE ss.campus_id = ANY(${idArr}::uuid[]) AND r.attendance_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY ss.campus_id, r.status`;
  const hostel = await tx.$queryRaw<{ campus_id: string; n: number }[]>`
    SELECT h.campus_id, COUNT(DISTINCT a.student_id)::int AS n FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id JOIN hostels h ON h.id = r.hostel_id
     WHERE h.campus_id = ANY(${idArr}::uuid[]) AND a.status IN ('CHECKED_IN','VACATED') AND a.check_in_date <= ${to}::date AND (a.check_out_date IS NULL OR a.check_out_date > ${to}::date)
     GROUP BY h.campus_id`;
  const fed = await tx.$queryRaw<{ campus_id: string; days: number; total: number }[]>`
    SELECT campus_id, COUNT(DISTINCT meal_date)::int AS days, SUM(GREATEST(breakfast, lunch, snacks, dinner))::int AS total
      FROM meal_counts WHERE campus_id = ANY(${idArr}::uuid[]) AND meal_date BETWEEN ${from}::date AND ${to}::date GROUP BY campus_id`;
  const welfare = await tx.$queryRaw<{ campus_id: string; n: number }[]>`
    SELECT campus_id, COUNT(*)::int AS n FROM welfare_distributions WHERE campus_id = ANY(${idArr}::uuid[]) AND given_on BETWEEN ${from}::date AND ${to}::date GROUP BY campus_id`;
  const sick = await tx.$queryRaw<{ campus_id: string; n: number }[]>`
    SELECT campus_id, COUNT(*)::int AS n FROM infirmary_visits WHERE campus_id = ANY(${idArr}::uuid[]) AND patient_type = 'STUDENT'
       AND (visit_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date GROUP BY campus_id`;
  const checkups = await tx.$queryRaw<{ campus_id: string; n: number }[]>`
    SELECT st.campus_id, COUNT(*)::int AS n FROM health_checkups c JOIN students st ON st.id = c.student_id
     WHERE st.campus_id = ANY(${idArr}::uuid[]) AND c.checkup_date BETWEEN ${from}::date AND ${to}::date GROUP BY st.campus_id`;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const diet = from <= today ? await DietService.prototype.summaryByCampus.call(DietService.prototype, tx, ids, from, to < today ? to : today) : new Map<string, { flagged: number }>();

  const n = (rows: { campus_id: string; n: number }[], id: string) => rows.find((r) => r.campus_id === id)?.n ?? 0;
  const out: Record<string, Cell>[] = [];
  const total: Record<string, number> = {};
  let attP = 0, attD = 0;
  for (const c of list) {
    const girls = roll.filter((r) => r.campus_id === c.id && r.gender === 'FEMALE').reduce((t, r) => t + r.n, 0);
    const boys = roll.filter((r) => r.campus_id === c.id && r.gender === 'MALE').reduce((t, r) => t + r.n, 0);
    const students = roll.filter((r) => r.campus_id === c.id).reduce((t, r) => t + r.n, 0);
    const a = Object.fromEntries(att.filter((r) => r.campus_id === c.id).map((r) => [r.status, r.n]));
    const marked = Object.values(a).reduce((t, v) => t + v, 0);
    const attended = (a.PRESENT ?? 0) + (a.LATE ?? 0) + (a.HALF_DAY ?? 0) * 0.5;
    attP += attended; attD += marked;
    const f2 = fed.find((r) => r.campus_id === c.id);
    const row = {
      girls, boys, students, joined: n(joined, c.id),
      movedIn: moves.filter((m) => m.toCampusId === c.id).length, movedOut: moves.filter((m) => m.fromCampusId === c.id).length,
      left: n(left, c.id), hostel: n(hostel, c.id), fedPerDay: f2 && f2.days ? Math.round(f2.total / f2.days) : 0,
      dietOff: diet.get(c.id)?.flagged ?? 0, welfare: n(welfare, c.id), sick: n(sick, c.id), checkups: n(checkups, c.id),
    };
    for (const [k, v] of Object.entries(row)) total[k] = (total[k] ?? 0) + v;
    out.push({ district: c.district ?? '—', school: c.name, ...row, attendance: marked ? Math.round((attended / marked) * 1000) / 10 : null });
  }
  if (list.length > 1) out.push({ district: 'All districts', school: `All ${list.length} schools`, ...total, attendance: attD ? Math.round((attP / attD) * 1000) / 10 : null });
  return out;
}
