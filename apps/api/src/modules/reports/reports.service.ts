import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { CatalogueReportCode, EXPORT_KEEP_DAYS, GOV_FIELDS, GOV_STANDARD_LAYOUTS, ExportInput, PERMISSIONS, ReportFilters, SavedReportInput, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, scopeFor } from '../../common/auth-context';
import { buildPermissionMap } from '../../common/access.guard';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { STORAGE, StorageDriver } from '../files/storage';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitlementsService } from '../platform/entitlements.service';
import { dec } from '../accounts/books';
import { day, fullName, iso, todayIST } from '../campuslife/common';
import { govColumns, govRows } from '../govt/gov-rows';
import { welfareStatusRows } from '../govt/welfare.service';
import { MIS_COLUMNS, misRows } from '../residential/mis';

type Perm = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
type Cell = string | number | null;
export interface Column { key: string; label: string; type: 'text' | 'money' | 'number' | 'date' | 'percent' }
type Filter = 'campusId' | 'sectionId' | 'storeId' | 'from' | 'to' | 'status' | 'mode' | 'passingYear' | 'minBalance' | 'schemeId';
interface ReportDef { code: CatalogueReportCode; module: string; group: string; title: string; perm: Perm; filters: Filter[]; columns: Column[]; /** Columns the institution can change (government exports). */ columnsFor?: (tx: Tx) => Promise<Column[]>; run: (tx: Tx, campuses: string[] | null, f: ReportFilters) => Promise<Record<string, Cell>[]> }

const SCREEN_ROWS = 500;
const EXPORT_MAX = 50_000;
const cw = (c: string[] | null, id?: string) => (id ? (c && !c.includes(id) ? '00000000-0000-0000-0000-000000000000' : id) : c ? { in: c } : undefined);
const klass = (e: { section: { name: string; level: { name: string } } }[]) => (e[0] ? `${e[0].section.level.name} ${e[0].section.name}` : null);
const enrolSel = { where: { status: 'ACTIVE' }, orderBy: { enrolledOn: 'desc' as const }, take: 1, select: { section: { select: { name: true, level: { select: { name: true } } } } } };

/**
 * The report catalogue (M19.4): standard reports read with each module's own right and campus scope,
 * so a report never shows what its user could not see on the module's own screens.
 */
const REPORTS: ReportDef[] = [
  {
    code: 'STUDENT_LIST', module: 'STUDENTS', group: 'STUDENTS', title: 'Student list', perm: PERMISSIONS.STU_STUDENT_READ, filters: ['campusId', 'sectionId', 'status'],
    columns: [{ key: 'admissionNo', label: 'Admission no', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'className', label: 'Class', type: 'text' }, { key: 'gender', label: 'Gender', type: 'text' }, { key: 'dob', label: 'Date of birth', type: 'date' }, { key: 'admissionDate', label: 'Admitted on', type: 'date' }, { key: 'status', label: 'Status', type: 'text' }],
    run: async (tx, c, f) => {
      const rows = await tx.student.findMany({
        where: { campusId: cw(c, f.campusId) as never, status: f.status || 'ACTIVE', ...(f.sectionId ? { enrollments: { some: { sectionId: f.sectionId, status: 'ACTIVE' } } } : {}) },
        orderBy: [{ firstName: 'asc' }], take: EXPORT_MAX,
        select: { admissionNo: true, firstName: true, lastName: true, gender: true, dob: true, admissionDate: true, status: true, enrollments: enrolSel },
      });
      return rows.map((s) => ({ admissionNo: s.admissionNo, name: fullName(s), className: klass(s.enrollments), gender: s.gender, dob: iso(s.dob), admissionDate: iso(s.admissionDate), status: s.status }));
    },
  },
  {
    code: 'FEE_DUES', module: 'FEES', group: 'FEES', title: 'Fee dues', perm: PERMISSIONS.FEE_READ, filters: ['campusId', 'sectionId', 'to', 'minBalance'],
    columns: [{ key: 'invoiceNo', label: 'Bill no', type: 'text' }, { key: 'student', label: 'Student', type: 'text' }, { key: 'admissionNo', label: 'Admission no', type: 'text' }, { key: 'className', label: 'Class', type: 'text' }, { key: 'description', label: 'For', type: 'text' }, { key: 'dueDate', label: 'Due on', type: 'date' }, { key: 'net', label: 'Bill amount', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }],
    run: async (tx, c, f) => {
      const rows = await tx.feeInvoice.findMany({
        where: { campusId: cw(c, f.campusId) as never, status: { in: ['UNPAID', 'PARTIAL'] }, balanceAmount: { gt: f.minBalance ?? 0 }, ...(f.to ? { dueDate: { lte: day(f.to) } } : {}), ...(f.sectionId ? { student: { enrollments: { some: { sectionId: f.sectionId, status: 'ACTIVE' } } } } : {}) },
        orderBy: [{ dueDate: 'asc' }, { invoiceNo: 'asc' }], take: EXPORT_MAX,
        select: { invoiceNo: true, description: true, dueDate: true, netAmount: true, paidAmount: true, balanceAmount: true, student: { select: { firstName: true, lastName: true, admissionNo: true, enrollments: enrolSel } } },
      });
      return rows.map((r) => ({ invoiceNo: r.invoiceNo, student: fullName(r.student), admissionNo: r.student.admissionNo, className: klass(r.student.enrollments), description: r.description, dueDate: iso(r.dueDate), net: dec(r.netAmount), paid: dec(r.paidAmount), balance: dec(r.balanceAmount) }));
    },
  },
  {
    code: 'FEE_COLLECTION', module: 'FEES', group: 'FEES', title: 'Fee collection', perm: PERMISSIONS.FEE_READ, filters: ['campusId', 'from', 'to', 'mode'],
    columns: [{ key: 'receiptNo', label: 'Receipt no', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'student', label: 'Student', type: 'text' }, { key: 'admissionNo', label: 'Admission no', type: 'text' }, { key: 'mode', label: 'Mode', type: 'text' }, { key: 'reference', label: 'Reference', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }],
    run: async (tx, c, f) => {
      const from = f.from ?? `${todayIST().slice(0, 7)}-01`, to = f.to ?? todayIST();
      const rows = await tx.payment.findMany({
        where: { campusId: cw(c, f.campusId) as never, status: 'SUCCESS', paymentDate: { gte: day(from), lte: day(to) }, ...(f.mode ? { paymentMode: f.mode } : {}) },
        orderBy: [{ paymentDate: 'asc' }, { receiptNo: 'asc' }], take: EXPORT_MAX,
        select: { receiptNo: true, paymentDate: true, paymentMode: true, referenceNo: true, amount: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } },
      });
      return rows.map((p) => ({ receiptNo: p.receiptNo, date: iso(p.paymentDate), student: fullName(p.student), admissionNo: p.student.admissionNo, mode: p.paymentMode, reference: p.referenceNo, amount: dec(p.amount) }));
    },
  },
  {
    code: 'ATTENDANCE_SUMMARY', module: 'ATTENDANCE', group: 'ATTENDANCE', title: 'Attendance summary by student', perm: PERMISSIONS.ATT_READ, filters: ['campusId', 'sectionId', 'from', 'to'],
    columns: [{ key: 'admissionNo', label: 'Admission no', type: 'text' }, { key: 'name', label: 'Student', type: 'text' }, { key: 'className', label: 'Class', type: 'text' }, { key: 'days', label: 'Days marked', type: 'number' }, { key: 'present', label: 'Present', type: 'number' }, { key: 'absent', label: 'Absent', type: 'number' }, { key: 'late', label: 'Late', type: 'number' }, { key: 'halfDay', label: 'Half day', type: 'number' }, { key: 'leave', label: 'Leave', type: 'number' }, { key: 'percent', label: 'Attendance %', type: 'percent' }],
    run: async (tx, c, f) => {
      const from = f.from ?? `${todayIST().slice(0, 7)}-01`, to = f.to ?? todayIST();
      const recs = await tx.attendanceRecord.findMany({
        where: { attendanceDate: { gte: day(from), lte: day(to) }, session: { campusId: cw(c, f.campusId) as never, periodId: null, ...(f.sectionId ? { sectionId: f.sectionId } : {}) } },
        select: { studentId: true, status: true },
      });
      const by = new Map<string, Record<string, number>>();
      for (const r of recs) { const m = by.get(r.studentId) ?? {}; m[r.status] = (m[r.status] ?? 0) + 1; by.set(r.studentId, m); }
      const st = await tx.student.findMany({ where: { id: { in: [...by.keys()] } }, select: { id: true, admissionNo: true, firstName: true, lastName: true, enrollments: enrolSel } });
      return st.map((s) => {
        const m = by.get(s.id)!;
        const days = Object.values(m).reduce((t, x) => t + x, 0);
        const attended = (m.PRESENT ?? 0) + (m.LATE ?? 0) + (m.HALF_DAY ?? 0) * 0.5;
        return { admissionNo: s.admissionNo, name: fullName(s), className: klass(s.enrollments), days, present: m.PRESENT ?? 0, absent: m.ABSENT ?? 0, late: m.LATE ?? 0, halfDay: m.HALF_DAY ?? 0, leave: m.LEAVE ?? 0, percent: days ? Math.round((attended * 1000) / days) / 10 : null };
      }).sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0) || a.name.localeCompare(b.name));
    },
  },
  {
    code: 'STAFF_LIST', module: 'SETUP', group: 'STAFF', title: 'Staff list', perm: PERMISSIONS.HR_STAFF_READ, filters: ['campusId', 'status'],
    columns: [{ key: 'code', label: 'Staff code', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'designation', label: 'Designation', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'joiningDate', label: 'Joined on', type: 'date' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }],
    run: async (tx, c, f) => {
      const rows = await tx.employee.findMany({ where: { campusId: cw(c, f.campusId) as never, ...(f.status ? { status: f.status } : { status: { notIn: ['RESIGNED', 'TERMINATED'] } }) }, orderBy: [{ firstName: 'asc' }], take: EXPORT_MAX });
      const depts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      return rows.map((e) => ({ code: e.employeeCode, name: fullName(e), designation: e.designation, department: e.departmentId ? depts.get(e.departmentId) ?? null : null, type: e.employeeType, joiningDate: iso(e.joiningDate), phone: e.phone, email: e.email, status: e.status }));
    },
  },
  {
    code: 'LIBRARY_OVERDUE', module: 'LIBRARY', group: 'LIBRARY', title: 'Library books overdue', perm: PERMISSIONS.LIB_CIRCULATE, filters: ['campusId'],
    columns: [{ key: 'accessionNo', label: 'Accession no', type: 'text' }, { key: 'title', label: 'Book', type: 'text' }, { key: 'borrower', label: 'Borrower', type: 'text' }, { key: 'kind', label: 'Member', type: 'text' }, { key: 'issueDate', label: 'Issued', type: 'date' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'daysLate', label: 'Days late', type: 'number' }],
    run: async (tx, c, f) => {
      const today = todayIST();
      const rows = await tx.libraryIssue.findMany({ where: { campusId: cw(c, f.campusId) as never, status: 'ISSUED', dueDate: { lt: day(today) } }, orderBy: { dueDate: 'asc' }, take: EXPORT_MAX });
      const copies = new Map((await tx.libraryCopy.findMany({ where: { id: { in: rows.map((r) => r.copyId) } }, select: { id: true, accessionNo: true, bookId: true } })).map((x) => [x.id, x]));
      const books = new Map((await tx.libraryBook.findMany({ where: { id: { in: [...copies.values()].map((x) => x.bookId) } }, select: { id: true, title: true } })).map((b) => [b.id, b.title]));
      const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, `${fullName(s)} (${s.admissionNo})`]));
      const em = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, `${fullName(e)} (${e.employeeCode})`]));
      return rows.map((r) => {
        const cp = copies.get(r.copyId);
        return { accessionNo: cp?.accessionNo ?? '', title: cp ? books.get(cp.bookId) ?? '' : '', borrower: r.studentId ? st.get(r.studentId) ?? '' : r.employeeId ? em.get(r.employeeId) ?? '' : '', kind: r.memberType, issueDate: iso(r.issueDate), dueDate: iso(r.dueDate), daysLate: Math.round((Date.parse(`${today}T00:00:00Z`) - r.dueDate.getTime()) / 86_400_000) };
      });
    },
  },
  {
    code: 'STOCK_VALUE', module: 'INVENTORY', group: 'INVENTORY', title: 'Stock and value by store', perm: PERMISSIONS.INV_READ, filters: ['campusId', 'storeId'],
    columns: [{ key: 'store', label: 'Store', type: 'text' }, { key: 'itemCode', label: 'Item code', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'quantity', label: 'In stock', type: 'number' }, { key: 'reorderLevel', label: 'Reorder level', type: 'number' }, { key: 'avgRate', label: 'Average rate', type: 'money' }, { key: 'value', label: 'Value', type: 'money' }],
    run: async (tx, c, f) => {
      const stores = await tx.store.findMany({ where: { campusId: cw(c, f.campusId) as never, ...(f.storeId ? { id: f.storeId } : {}) }, select: { id: true, name: true } });
      const bal = await tx.stockBalance.findMany({ where: { storeId: { in: stores.map((s) => s.id) }, quantity: { gt: 0 } } });
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: bal.map((b) => b.itemId) } } })).map((i) => [i.id, i]));
      const sn = new Map(stores.map((s) => [s.id, s.name]));
      return bal.map((b) => { const i = items.get(b.itemId)!; return { store: sn.get(b.storeId) ?? '', itemCode: i.itemCode, item: i.name, unit: i.unit, quantity: Number(b.quantity), reorderLevel: Number(i.reorderLevel), avgRate: Number(b.avgCost).toFixed(2), value: dec(b.value) }; })
        .sort((a, b) => a.store.localeCompare(b.store) || a.item.localeCompare(b.item));
    },
  },
  {
    code: 'ACHIEVEMENTS', module: 'SPORTS', group: 'ACTIVITIES', title: 'Verified achievements', perm: PERMISSIONS.ACT_READ, filters: ['campusId', 'from', 'to'],
    columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'person', label: 'Student / staff', type: 'text' }, { key: 'code', label: 'Admission / staff no', type: 'text' }, { key: 'title', label: 'Achievement', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'level', label: 'Level', type: 'text' }],
    run: async (tx, c, f) => {
      const rows = await tx.achievement.findMany({ where: { campusId: cw(c, f.campusId) as never, isVerified: true, ...(f.from || f.to ? { achievementDate: { ...(f.from ? { gte: day(f.from) } : {}), ...(f.to ? { lte: day(f.to) } : {}) } } : {}) }, orderBy: { achievementDate: 'desc' }, take: EXPORT_MAX });
      const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
      const em = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, e]));
      return rows.map((r) => { const s = r.studentId ? st.get(r.studentId) : null; const e = r.employeeId ? em.get(r.employeeId) : null; return { date: iso(r.achievementDate), person: s ? fullName(s) : e ? fullName(e) : '', code: s?.admissionNo ?? e?.employeeCode ?? '', title: r.title, category: r.category, level: r.level }; });
    },
  },
  {
    code: 'PLACEMENT_OFFERS', module: 'PLACEMENTS', group: 'PLACEMENTS', title: 'Placement offers', perm: PERMISSIONS.PLACE_READ, filters: ['campusId', 'passingYear', 'status'],
    columns: [{ key: 'student', label: 'Student', type: 'text' }, { key: 'admissionNo', label: 'Admission no', type: 'text' }, { key: 'company', label: 'Company', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }, { key: 'jobType', label: 'Type', type: 'text' }, { key: 'ctc', label: 'CTC (₹ a year)', type: 'money' }, { key: 'offerDate', label: 'Offer date', type: 'date' }, { key: 'status', label: 'Status', type: 'text' }],
    run: async (tx, c, f) => {
      const drives = await tx.placementDrive.findMany({ where: { campusId: cw(c, f.campusId) as never, ...(f.passingYear ? { passingYear: f.passingYear } : {}) }, select: { id: true, title: true, jobType: true, companyId: true } });
      const apps = await tx.placementApplication.findMany({ where: { driveId: { in: drives.map((d) => d.id) } }, select: { id: true, driveId: true } });
      const offers = await tx.placementOffer.findMany({ where: { applicationId: { in: apps.map((a) => a.id) }, ...(f.status ? { status: f.status } : {}) }, orderBy: { offerDate: 'desc' }, take: EXPORT_MAX });
      const st = new Map((await tx.student.findMany({ where: { id: { in: offers.map((o) => o.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
      const comp = new Map((await tx.company.findMany({ where: { id: { in: drives.map((d) => d.companyId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      return offers.map((o) => { const d = drives.find((x) => x.id === apps.find((a) => a.id === o.applicationId)!.driveId)!; const s = st.get(o.studentId); return { student: s ? fullName(s) : '', admissionNo: s?.admissionNo ?? '', company: comp.get(d.companyId) ?? '', role: d.title, jobType: d.jobType, ctc: dec(o.ctc), offerDate: iso(o.offerDate), status: o.status }; });
    },
  },
  {
    code: 'GOV_SATS', module: 'STUDENTS', group: 'GOVERNMENT', title: 'SATS student data', perm: PERMISSIONS.STU_STUDENT_READ, filters: ['campusId', 'sectionId'],
    columns: GOV_STANDARD_LAYOUTS.SATS.map((k) => ({ key: k, label: GOV_FIELDS.find((f) => f.key === k)!.label, type: GOV_FIELDS.find((f) => f.key === k)!.type })),
    columnsFor: (tx) => govColumns(tx, 'SATS'),
    run: async (tx, c, f) => (await govRows(tx, c, { campusId: f.campusId, sectionId: f.sectionId }, EXPORT_MAX)) as unknown as Record<string, Cell>[],
  },
  {
    code: 'GOV_UDISE', module: 'STUDENTS', group: 'GOVERNMENT', title: 'UDISE+ student data', perm: PERMISSIONS.STU_STUDENT_READ, filters: ['campusId', 'sectionId'],
    columns: GOV_STANDARD_LAYOUTS.UDISE.map((k) => ({ key: k, label: GOV_FIELDS.find((f) => f.key === k)!.label, type: GOV_FIELDS.find((f) => f.key === k)!.type })),
    columnsFor: (tx) => govColumns(tx, 'UDISE'),
    run: async (tx, c, f) => (await govRows(tx, c, { campusId: f.campusId, sectionId: f.sectionId }, EXPORT_MAX)) as unknown as Record<string, Cell>[],
  },
  {
    code: 'STAFF_GOVT', module: 'SETUP', group: 'STAFF', title: 'Staff for HRMS (government details)', perm: PERMISSIONS.HR_PROFILE_READ, filters: ['campusId', 'status'],
    columns: [{ key: 'code', label: 'Staff code', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'designation', label: 'Designation', type: 'text' }, { key: 'campus', label: 'School (campus)', type: 'text' }, { key: 'ddoCode', label: 'DDO code', type: 'text' }, { key: 'employment', label: 'Employment', type: 'text' }, { key: 'kgidNo', label: 'KGID no', type: 'text' }, { key: 'hrmsId', label: 'HRMS ID', type: 'text' }, { key: 'pranNo', label: 'PRAN', type: 'text' }, { key: 'gpfNo', label: 'GPF no', type: 'text' }, { key: 'payScale', label: 'Pay scale', type: 'text' }, { key: 'govtServiceDate', label: 'In government service from', type: 'date' }, { key: 'joiningDate', label: 'Joined this school on', type: 'date' }, { key: 'status', label: 'Status', type: 'text' }],
    run: async (tx, c, f) => {
      const rows = await tx.employee.findMany({ where: { campusId: cw(c, f.campusId) as never, ...(f.status ? { status: f.status } : { status: { notIn: ['RESIGNED', 'TERMINATED'] } }) }, orderBy: [{ firstName: 'asc' }], take: EXPORT_MAX });
      const det = new Map((await tx.employeeDetail.findMany({ where: { employeeId: { in: rows.map((e) => e.id) } } })).map((d) => [d.employeeId, d]));
      const camp = new Map((await tx.campus.findMany({ select: { id: true, name: true, ddoCode: true } })).map((x) => [x.id, x]));
      return rows.map((e) => { const d = det.get(e.id); const cp = camp.get(e.campusId); return { code: e.employeeCode, name: fullName(e), designation: e.designation, campus: cp?.name ?? null, ddoCode: cp?.ddoCode ?? null, employment: d?.govtEmployment ?? null, kgidNo: d?.kgidNo ?? null, hrmsId: d?.hrmsId ?? null, pranNo: d?.pranNo ?? null, gpfNo: d?.gpfNo ?? null, payScale: d?.payScale ?? null, govtServiceDate: iso(d?.govtServiceDate), joiningDate: iso(e.joiningDate), status: e.status }; });
    },
  },
  {
    code: 'WELFARE_STATUS', module: 'STUDENTS', group: 'GOVERNMENT', title: 'Welfare items and allowances by student', perm: PERMISSIONS.WELFARE_READ, filters: ['campusId', 'sectionId', 'schemeId'],
    columns: [{ key: 'scheme', label: 'Scheme', type: 'text' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'student', label: 'Student', type: 'text' }, { key: 'admissionNo', label: 'Admission no', type: 'text' }, { key: 'className', label: 'Class', type: 'text' }, { key: 'entitled', label: 'Entitled', type: 'number' }, { key: 'received', label: 'Received', type: 'number' }, { key: 'pending', label: 'Pending', type: 'number' }, { key: 'lastGiven', label: 'Last given on', type: 'date' }],
    run: (tx, c, f) => welfareStatusRows(tx, c, f),
  },
  {
    code: 'MIS_MONTHLY', module: 'STUDENTS', group: 'GOVERNMENT', title: 'Monthly report by school', perm: PERMISSIONS.OVERVIEW_READ, filters: ['campusId', 'from', 'to'],
    columns: MIS_COLUMNS.map((c) => ({ ...c })) as Column[],
    run: (tx, c, f) => misRows(tx, c, f),
  },
];
const DEF = new Map(REPORTS.map((r) => [r.code, r]));

/** Reports & exports (M19.4): run on screen, save filters, export to Excel / CSV in the background. */
@Injectable()
export class ReportsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService, @Inject(STORAGE) private readonly storage: StorageDriver) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, def: ReportDef): string[] | null | false {
    const s: CampusScope | null = scopeFor(auth, def.perm);
    if (!s) return false;
    return s.all ? null : s.campusIds;
  }
  private def(code: string) {
    const d = DEF.get(code as CatalogueReportCode);
    if (!d) throw NotFound('Report');
    return d;
  }
  private enabled(tx: Tx): Promise<Set<string>> {
    return EntitlementsService.enabledModules(tx);
  }
  private async allowed(tx: Tx, auth: AuthContext, code: string) {
    const d = this.def(code);
    const sc = this.scope(auth, d);
    if (sc === false) throw NotFound('Report');
    if (d.module !== 'SETUP' && !(await this.enabled(tx)).has(d.module)) throw NotFound('Report');
    return { d, campuses: sc };
  }

  catalogue(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const on = await this.enabled(tx);
      const list = REPORTS.filter((d) => this.scope(auth, d) !== false && (d.module === 'SETUP' || on.has(d.module)));
      return Promise.all(list.map(async (d) => ({ code: d.code, group: d.group, title: d.title, filters: d.filters, columns: await this.cols(tx, d) })));
    });
  }

  options(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const [campuses, sections, stores] = await Promise.all([
        tx.campus.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.section.findMany({ where: { status: 'ACTIVE', academicYear: { isCurrent: true } }, orderBy: [{ level: { sequence: 'asc' } }, { name: 'asc' }], select: { id: true, name: true, campusId: true, level: { select: { name: true } } } }),
        tx.store.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }).catch(() => []),
      ]);
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const schemes = year ? await tx.welfareScheme.findMany({ where: { academicYearId: year.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [];
      return { campuses, stores, schemes, sections: sections.map((s) => ({ id: s.id, name: `${s.level.name} ${s.name}`, campusId: s.campusId })) };
    });
  }

  run(code: string, filters: ReportFilters, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { d, campuses } = await this.allowed(tx, auth, code);
      const rows = await d.run(tx, campuses, filters);
      return { code: d.code, title: d.title, columns: await this.cols(tx, d), total: rows.length, rows: rows.slice(0, SCREEN_ROWS), truncated: rows.length > SCREEN_ROWS, totals: this.totals(d, rows) };
    });
  }

  private cols(tx: Tx, d: ReportDef): Promise<Column[]> {
    return d.columnsFor ? d.columnsFor(tx) : Promise.resolve(d.columns);
  }

  private totals(d: ReportDef, rows: Record<string, Cell>[]) {
    const money = d.columns.filter((c) => c.type === 'money');
    if (!money.length || !rows.length) return null;
    return Object.fromEntries(money.map((c) => [c.key, fromPaise(rows.reduce((t, r) => t + (r[c.key] == null ? 0 : toPaise(String(r[c.key]))), 0))]));
  }

  // ───────────── Saved reports ─────────────

  saved(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.savedReport.findMany({ where: { OR: [{ userId: auth.userId! }, { isShared: true }] }, orderBy: [{ name: 'asc' }] });
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return rows.filter((r) => { const d = DEF.get(r.reportCode as CatalogueReportCode); return d && this.scope(auth, d) !== false; })
        .map((r) => ({ id: r.id, reportCode: r.reportCode, title: DEF.get(r.reportCode as CatalogueReportCode)!.title, name: r.name, filters: r.filters, isShared: r.isShared, schedule: r.schedule, scheduleFormat: r.scheduleFormat, lastSentAt: r.lastSentAt, mine: r.userId === auth.userId, owner: users.get(r.userId) ?? '' }));
    });
  }

  saveReport(id: string | null, input: SavedReportInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.allowed(tx, auth, input.reportCode);
      const old = id ? await tx.savedReport.findUnique({ where: { id } }) : null;
      if (id && (!old || old.userId !== auth.userId)) throw NotFound('Saved report');
      const data = { reportCode: input.reportCode, name: input.name, filters: input.filters as object, isShared: input.isShared, schedule: input.schedule, scheduleFormat: input.scheduleFormat };
      const row = old ? await tx.savedReport.update({ where: { id: old.id }, data }) : await tx.savedReport.create({ data: { ...data, tenantId: auth.tenantId!, userId: auth.userId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'SAVED_REPORT', entityId: row.id, newValues: data }, client);
      return { id: row.id };
    });
  }

  deleteReport(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = await tx.savedReport.findUnique({ where: { id } });
      if (!old || old.userId !== auth.userId) throw NotFound('Saved report');
      await tx.savedReport.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'DELETE', entityType: 'SAVED_REPORT', entityId: id, oldValues: { name: old.name, reportCode: old.reportCode } }, client);
      return { deleted: true };
    });
  }

  // ───────────── Exports ─────────────

  requestExport(input: ExportInput, auth: AuthContext, client: ClientInfo, savedReportId: string | null = null) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { d } = await this.allowed(tx, auth, input.reportCode);
      const running = await tx.exportJob.count({ where: { userId: auth.userId!, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (running >= 5) throw Conflict('too-many-exports', 'Five exports are already waiting — try again when they finish');
      const job = await tx.exportJob.create({ data: { tenantId: auth.tenantId!, userId: auth.userId!, reportCode: d.code, filters: input.filters as object, format: input.format, savedReportId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'EXPORT_JOB', entityId: job.id, newValues: { report: d.code, format: input.format, filters: input.filters } }, client);
      return { id: job.id, status: job.status };
    });
  }

  exports(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.exportJob.findMany({ where: { userId: auth.userId! }, orderBy: { createdAt: 'desc' }, take: 50 });
      const now = Date.now();
      return rows.map((j) => ({ id: j.id, reportCode: j.reportCode, title: DEF.get(j.reportCode as CatalogueReportCode)?.title ?? j.reportCode, format: j.format, status: j.status, rowCount: j.rowCount, sizeBytes: j.sizeBytes, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt, expiresAt: j.expiresAt, expired: !!j.expiresAt && j.expiresAt.getTime() < now, filters: j.filters, downloads: j.downloads }));
    });
  }

  async download(id: string, auth: AuthContext) {
    const j = await this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.exportJob.findUnique({ where: { id } });
      if (!x || x.userId !== auth.userId) throw NotFound('Export');
      if (x.status !== 'DONE' || !x.storageKey) throw Conflict('export-not-ready', 'This export is not ready');
      if (x.expiresAt && x.expiresAt.getTime() < Date.now()) throw Conflict('export-expired', 'This export has expired — export it again');
      await tx.exportJob.update({ where: { id }, data: { downloads: { increment: 1 } } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'EXPORT', entityType: 'EXPORT_JOB', entityId: id, newValues: { report: x.reportCode, rows: x.rowCount } });
      return x;
    });
    return { fileName: j.fileName!, mime: j.format === 'XLSX' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', size: j.sizeBytes ?? undefined, stream: await this.storage.open(j.storageKey!) };
  }

  /** The requesting user's rights, as the request guard would build them (for the worker). */
  private async authFor(tx: Tx, tenantId: string, userId: string): Promise<AuthContext> {
    const roles = await tx.userRole.findMany({ where: { userId }, select: { campusId: true, role: { select: { rolePermissions: { select: { permission: { select: { code: true } } } } } } } });
    return { tenantId, userId, platformRole: null, tenantStatus: 'ACTIVE', permissions: buildPermissionMap(roles) } as unknown as AuthContext;
  }

  /** Builds one export file (rights are checked again as the user, at run time). */
  private async build(tenantId: string, jobId: string) {
    const job = await this.db.run({ tenantId, userId: null }, (tx) => tx.exportJob.findUniqueOrThrow({ where: { id: jobId } }));
    try {
      const result = await this.db.run({ tenantId, userId: job.userId }, async (tx) => {
        const auth = await this.authFor(tx, tenantId, job.userId);
        const { d, campuses } = await this.allowed(tx, auth, job.reportCode);
        return { d, columns: await this.cols(tx, d), rows: await d.run(tx, campuses, job.filters as ReportFilters) };
      });
      const { d, rows, columns } = result;
      const stamp = todayIST();
      let buffer: Buffer;
      if (job.format === 'CSV') {
        const esc = (v: Cell) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        buffer = Buffer.from(`﻿${[columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n')}\r\n`, 'utf8');
      } else {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'EduERP';
        const ws = wb.addWorksheet(d.title.slice(0, 31));
        ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(40, Math.max(12, c.label.length + 4)), style: c.type === 'money' ? { numFmt: '#,##,##0.00' } : c.type === 'percent' ? { numFmt: '0.0' } : {} }));
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, r[c.key] == null ? null : c.type === 'money' || c.type === 'number' || c.type === 'percent' ? Number(r[c.key]) : c.type === 'date' ? new Date(`${r[c.key]}T00:00:00Z`) : r[c.key]])));
        buffer = Buffer.from(await wb.xlsx.writeBuffer());
      }
      const ext = job.format === 'CSV' ? 'csv' : 'xlsx';
      const key = `t/${tenantId}/exports/${job.id}.${ext}`;
      await this.storage.put(key, buffer, job.format === 'CSV' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await this.db.run({ tenantId, userId: null }, async (tx) => {
        await tx.exportJob.update({ where: { id: job.id }, data: { status: 'DONE', rowCount: rows.length, storageKey: key, fileName: `${d.code.toLowerCase().replace(/_/g, '-')}-${stamp}.${ext}`, sizeBytes: buffer.length, finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPORT_KEEP_DAYS * 86_400_000) } });
        await this.notifications.notify(tx, { tenantId, userIds: [job.userId], eventCode: 'REPORT_READY', vars: { report: d.title, rows: String(rows.length) }, entityType: 'EXPORT_JOB', entityId: job.id });
        if (job.savedReportId) await tx.savedReport.updateMany({ where: { id: job.savedReportId }, data: { lastSentAt: new Date() } });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.db.run({ tenantId, userId: null }, (tx) => tx.exportJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: msg.slice(0, 500), finishedAt: new Date() } }));
    }
  }

  /** Worker: claims queued exports (one worker per job) and builds them; removes expired files. */
  async processQueued(limit = 5): Promise<number> {
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED'] } }, select: { id: true } }));
    let done = 0;
    for (const t of tenants) {
      const claimed = await this.db.run({ tenantId: t.id, userId: null }, async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM export_jobs WHERE status = 'QUEUED' ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        if (rows.length) await tx.exportJob.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'RUNNING', startedAt: new Date() } });
        return rows.map((r) => r.id);
      });
      for (const id of claimed) { await this.build(t.id, id); done++; }
      const expired = await this.db.run({ tenantId: t.id, userId: null }, (tx) => tx.exportJob.findMany({ where: { status: 'DONE', expiresAt: { lt: new Date() }, sizeBytes: { gt: 0 } }, select: { id: true, storageKey: true } }));
      for (const x of expired) {
        await this.storage.remove(x.storageKey!).catch(() => undefined);
        await this.db.run({ tenantId: t.id, userId: null }, (tx) => tx.exportJob.update({ where: { id: x.id }, data: { sizeBytes: 0 } }));
      }
    }
    return done;
  }

  /** Worker (hourly): queues saved reports that are due to be emailed (weekly / monthly). */
  async queueScheduled(): Promise<number> {
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } }, select: { id: true } }));
    let n = 0;
    for (const t of tenants) {
      n += await this.db.run({ tenantId: t.id, userId: null }, async (tx) => {
        const due = await tx.savedReport.findMany({ where: { schedule: { in: ['WEEKLY', 'MONTHLY'] } } });
        let queued = 0;
        for (const s of due) {
          const gap = s.schedule === 'WEEKLY' ? 7 : 30;
          if (s.lastSentAt && Date.now() - s.lastSentAt.getTime() < gap * 86_400_000) continue;
          if (await tx.exportJob.findFirst({ where: { savedReportId: s.id, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } })) continue;
          await tx.exportJob.create({ data: { tenantId: t.id, userId: s.userId, savedReportId: s.id, reportCode: s.reportCode, filters: s.filters as object, format: s.scheduleFormat } });
          await tx.savedReport.update({ where: { id: s.id }, data: { lastSentAt: new Date() } });
          queued++;
        }
        return queued;
      });
    }
    return n;
  }
}
