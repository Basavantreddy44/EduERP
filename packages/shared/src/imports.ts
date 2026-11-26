import { z } from 'zod';

/**
 * Import/export catalogue (G-12). Each type lists its spreadsheet columns once: the template,
 * the upload check, the error report, the export and the web help all use this list, so an
 * exported file can be edited and imported again.
 */
export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
  example: string;
  help: string;
}

export interface ImportType {
  type: string;
  label: string;
  description: string;
  columns: ImportColumn[];
}

export const IMPORT_TYPES = {
  DEPARTMENTS: {
    type: 'DEPARTMENTS',
    label: 'Departments',
    description: 'Academic departments and offices.',
    columns: [
      { key: 'name', header: 'Name', required: true, example: 'Science', help: '2–100 characters.' },
      { key: 'code', header: 'Code', required: true, example: 'SCI', help: '2–20 letters, digits, - or _. Unique per campus.' },
      { key: 'deptType', header: 'Type', required: true, example: 'Academic', help: 'Academic, Administration or Support.' },
      { key: 'campusCode', header: 'Campus code', required: false, example: 'MAIN', help: 'Leave empty for the whole institution.' },
    ],
  },
  HOLIDAYS: {
    type: 'HOLIDAYS',
    label: 'Holidays',
    description: 'Public and institution holidays for the calendar.',
    columns: [
      { key: 'holidayDate', header: 'Date', required: true, example: '2026-11-01', help: 'YYYY-MM-DD or DD-MM-YYYY (an Excel date also works).' },
      { key: 'name', header: 'Name', required: true, example: 'Kannada Rajyotsava', help: '2–100 characters.' },
      { key: 'holidayType', header: 'Type', required: false, example: 'Public holiday', help: 'Public holiday, Institution holiday or Exam break. Default: Public holiday.' },
      { key: 'campusCode', header: 'Campus code', required: false, example: '', help: 'Leave empty for all campuses.' },
    ],
  },
  USERS: {
    type: 'USERS',
    label: 'Staff & users',
    description: 'Invite many people at once. Each gets an email to set their password.',
    columns: [
      { key: 'fullName', header: 'Full name', required: true, example: 'Priya Sharma', help: '2–150 characters.' },
      { key: 'email', header: 'Email', required: true, example: 'priya.sharma@school.in', help: 'Must be unique in the file.' },
      { key: 'role', header: 'Role', required: true, example: 'Head of Department', help: 'A role name or code of this institution.' },
      { key: 'campusCode', header: 'Campus code', required: false, example: '', help: 'Leave empty for access to all campuses.' },
    ],
  },
  STUDENTS: {
    type: 'STUDENTS',
    label: 'Students',
    description: 'Existing students with their class and parents, placed in the current academic year.',
    columns: [
      { key: 'admissionNo', header: 'Admission no', required: false, example: 'ADM/2025-26/0142', help: 'Your existing number. Leave empty to give the next number automatically.' },
      { key: 'firstName', header: 'First name', required: true, example: 'Ananya', help: '1–80 characters.' },
      { key: 'lastName', header: 'Last name', required: false, example: 'Rao', help: 'Up to 80 characters.' },
      { key: 'dob', header: 'Date of birth', required: true, example: '2016-04-12', help: 'YYYY-MM-DD or DD-MM-YYYY.' },
      { key: 'gender', header: 'Gender', required: true, example: 'Girl', help: 'Boy, Girl or Other.' },
      { key: 'category', header: 'Category', required: false, example: '2A', help: 'GENERAL, SC, ST, OBC, CAT_1, 2A, 2B, 3A or 3B.' },
      { key: 'motherTongue', header: 'Mother tongue', required: false, example: 'Kannada', help: 'Up to 30 characters.' },
      { key: 'aadhaarLast4', header: 'Aadhaar (last 4 digits)', required: false, example: '4321', help: 'Only the last 4 digits. A full Aadhaar number is refused.' },
      { key: 'bloodGroup', header: 'Blood group', required: false, example: 'B+', help: 'A+, A-, B+, B-, AB+, AB-, O+ or O-.' },
      { key: 'campusCode', header: 'Campus code', required: true, example: 'MAIN', help: 'A campus code from the Help sheet.' },
      { key: 'programCode', header: 'Programme code', required: true, example: 'SBS', help: 'A programme code from the Help sheet.' },
      { key: 'className', header: 'Class', required: true, example: 'Class 5', help: 'As named in the programme, e.g. Class 5, I PUC, Semester 1.' },
      { key: 'section', header: 'Section', required: true, example: 'A', help: 'A section of that class in the current academic year.' },
      { key: 'rollNo', header: 'Roll no', required: false, example: '12', help: 'Up to 10 characters.' },
      { key: 'admissionDate', header: 'Admission date', required: false, example: '2025-06-02', help: 'YYYY-MM-DD or DD-MM-YYYY. Default: today.' },
      { key: 'fatherName', header: 'Father name', required: false, example: 'Suresh Rao', help: 'At least one of father, mother or guardian.' },
      { key: 'motherName', header: 'Mother name', required: false, example: 'Lakshmi Rao', help: '' },
      { key: 'guardianName', header: 'Guardian name', required: false, example: '', help: '' },
      { key: 'parentPhone', header: 'Parent mobile', required: true, example: '9876543210', help: '10-digit mobile of the main contact. Brothers and sisters with the same mobile share parents.' },
      { key: 'parentEmail', header: 'Parent email', required: false, example: '', help: '' },
      { key: 'address', header: 'Address', required: false, example: '12, 4th Cross, Jayanagar, Bengaluru', help: 'Up to 500 characters.' },
    ],
  },
  STAFF: {
    type: 'STAFF',
    label: 'Staff',
    description: 'Teaching and non-teaching staff. A login can be linked later from the staff page.',
    columns: [
      { key: 'employeeCode', header: 'Employee code', required: false, example: 'EMP-0012', help: 'Your existing code. Leave empty to give the next number automatically.' },
      { key: 'firstName', header: 'First name', required: true, example: 'Priya', help: '1–80 characters.' },
      { key: 'lastName', header: 'Last name', required: false, example: 'Sharma', help: 'Up to 80 characters.' },
      { key: 'gender', header: 'Gender', required: true, example: 'Female', help: 'Male, Female or Other.' },
      { key: 'dob', header: 'Date of birth', required: false, example: '1988-07-21', help: 'YYYY-MM-DD or DD-MM-YYYY.' },
      { key: 'phone', header: 'Mobile', required: false, example: '9845012345', help: '10-digit mobile.' },
      { key: 'email', header: 'Email', required: false, example: 'priya.sharma@school.in', help: '' },
      { key: 'campusCode', header: 'Campus code', required: true, example: 'MAIN', help: 'A campus code from the Help sheet.' },
      { key: 'departmentCode', header: 'Department code', required: false, example: 'SCI', help: 'A department code from the Help sheet.' },
      { key: 'designation', header: 'Designation', required: false, example: 'Assistant Teacher', help: 'Up to 80 characters.' },
      { key: 'employeeType', header: 'Staff type', required: true, example: 'Teaching', help: 'Teaching, Non-teaching, Contract or Visiting.' },
      { key: 'joiningDate', header: 'Joining date', required: true, example: '2019-06-01', help: 'YYYY-MM-DD or DD-MM-YYYY.' },
    ],
  },
  LIBRARY_BOOKS: {
    type: 'LIBRARY_BOOKS',
    label: 'Library books',
    description: 'The existing accession register: one row per copy. Copies with the same title and ISBN become one book.',
    columns: [
      { key: 'accessionNo', header: 'Accession no', required: false, example: '1045', help: 'Leave empty to number automatically. Must be unique.' },
      { key: 'title', header: 'Title', required: true, example: 'Wings of Fire', help: 'Up to 300 characters.' },
      { key: 'authors', header: 'Author(s)', required: false, example: 'A. P. J. Abdul Kalam', help: '' },
      { key: 'isbn', header: 'ISBN', required: false, example: '9788173711466', help: '10 or 13 digits.' },
      { key: 'publisher', header: 'Publisher', required: false, example: 'Universities Press', help: '' },
      { key: 'edition', header: 'Edition', required: false, example: '1st', help: '' },
      { key: 'publishYear', header: 'Year', required: false, example: '1999', help: '' },
      { key: 'language', header: 'Language', required: false, example: 'English', help: '' },
      { key: 'subject', header: 'Subject', required: false, example: 'Biography', help: '' },
      { key: 'callNo', header: 'Call no', required: false, example: '920 KAL', help: 'Shelf classification.' },
      { key: 'campusCode', header: 'Campus code', required: true, example: 'MAIN', help: 'Where the copy is kept.' },
      { key: 'barcode', header: 'Barcode', required: false, example: '', help: 'If different from the accession number.' },
      { key: 'price', header: 'Price', required: false, example: '295', help: 'In rupees.' },
      { key: 'purchaseDate', header: 'Purchase date', required: false, example: '2021-07-12', help: 'YYYY-MM-DD or DD-MM-YYYY.' },
      { key: 'rackLocation', header: 'Rack', required: false, example: 'R3-S2', help: '' },
    ],
  },
  ALLOTMENTS: {
    type: 'ALLOTMENTS',
    label: 'Allotment list',
    description: 'Children allotted to your schools by the entrance / counselling list, for the current academic year. Each school then marks who joined.',
    columns: [
      { key: 'entranceRegNo', header: 'Entrance reg no', required: true, example: 'MDRS26-004512', help: 'The registration number from the entrance test. Unique in the year.' },
      { key: 'firstName', header: 'First name', required: true, example: 'Kavya', help: '1–100 characters.' },
      { key: 'lastName', header: 'Last name', required: false, example: 'Gowda', help: 'Up to 100 characters.' },
      { key: 'gender', header: 'Gender', required: true, example: 'Girl', help: 'Boy, Girl or Other.' },
      { key: 'dob', header: 'Date of birth', required: true, example: '2015-03-14', help: 'YYYY-MM-DD or DD-MM-YYYY.' },
      { key: 'category', header: 'Category', required: false, example: 'SC', help: 'GENERAL, SC, ST, OBC, CAT_1, 2A, 2B, 3A or 3B.' },
      { key: 'quota', header: 'Quota', required: false, example: 'SC rural', help: 'The seat category in the allotment, up to 60 characters.' },
      { key: 'rank', header: 'Rank', required: false, example: '1245', help: 'Merit rank, a whole number.' },
      { key: 'campusCode', header: 'School code', required: true, example: 'HNS', help: 'The code of the allotted school (campus) from the Help sheet.' },
      { key: 'className', header: 'Class', required: true, example: 'Class 6', help: 'The class the child joins, as named in your classes.' },
      { key: 'fatherName', header: 'Father name', required: false, example: 'Ramesh Gowda', help: '' },
      { key: 'motherName', header: 'Mother name', required: false, example: 'Lakshmamma', help: '' },
      { key: 'parentPhone', header: 'Parent mobile', required: true, example: '9844012345', help: '10-digit mobile.' },
      { key: 'address', header: 'Address', required: false, example: 'Bilikere, Hunsur taluk, Mysuru', help: 'Up to 500 characters.' },
    ],
  },
  OPENING_DUES: {
    type: 'OPENING_DUES',
    label: 'Opening dues',
    description: 'What each student still owed before EduERP, one row per student and year. Each row becomes a bill marked "Opening due" that is collected, reminded and reported like any bill.',
    columns: [
      { key: 'admissionNo', header: 'Admission no', required: true, example: 'ADM/2023/0142', help: 'The student must already be in EduERP.' },
      { key: 'yearLabel', header: 'Year', required: true, example: '2025-26', help: 'The academic year the dues belong to, before the current one. One row per student and year.' },
      { key: 'description', header: 'Description', required: false, example: 'Balance tuition fee 2025-26', help: 'Up to 200 characters. Default: Opening dues <year>.' },
      { key: 'amount', header: 'Amount', required: true, example: '4500', help: 'In rupees, more than 0, up to 2 decimals.' },
      { key: 'dueDate', header: 'Due date', required: false, example: '2026-06-30', help: 'YYYY-MM-DD or DD-MM-YYYY. Default: today.' },
    ],
  },
} as const satisfies Record<string, ImportType>;

export type ImportTypeCode = keyof typeof IMPORT_TYPES;
export const IMPORT_TYPE_CODES = Object.keys(IMPORT_TYPES) as [ImportTypeCode, ...ImportTypeCode[]];
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_MB = 5;

export const importTypeParam = z.enum(IMPORT_TYPE_CODES);
export const importRowsQuerySchema = z.object({
  status: z.enum(['VALID', 'INVALID', 'IMPORTED', 'SKIPPED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const exportQuerySchema = z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') });

/** Export types: everything importable, plus campuses (read-only list). */
export const EXPORT_TYPES = ['CAMPUSES', 'FEE_DUES', ...IMPORT_TYPE_CODES] as const;
export const exportTypeParam = z.enum(EXPORT_TYPES);
