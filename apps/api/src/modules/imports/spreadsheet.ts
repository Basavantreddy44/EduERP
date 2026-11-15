import { HttpStatus } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { IMPORT_MAX_ROWS, ImportColumn } from '@eduerp/shared';
import { AppError } from '../../common/problem';

export type RawRow = { rowNo: number; values: Record<string, string> };

const NAVY = 'FF13285A';
const GOLD_SOFT = 'FFF7EFDD';

const bad = (code: string, detail: string, errors?: unknown) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, errors);

/** Header text → column key, ignoring case, spaces and a trailing "*". */
const norm = (h: string) => h.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** Excel cells can be dates, numbers, rich text, formulas or hyperlinks: reduce all to plain text. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

function mapRows(header: string[], body: string[][], columns: readonly ImportColumn[]): RawRow[] {
  const byHeader = new Map(columns.map((c) => [norm(c.header), c.key]));
  const keyAt = header.map((h) => byHeader.get(norm(h)) ?? null);
  const present = new Set(keyAt.filter(Boolean));
  const missing = columns.filter((c) => c.required && !present.has(c.key)).map((c) => c.header);
  if (missing.length) {
    throw bad('import-columns', `The file is missing these columns: ${missing.join(', ')}. Download the template to see the expected headers.`, missing.map((m) => ({ field: m, message: 'Column missing' })));
  }
  const rows: RawRow[] = [];
  body.forEach((cells, i) => {
    const values: Record<string, string> = {};
    keyAt.forEach((k, j) => {
      if (k) values[k] = (cells[j] ?? '').trim();
    });
    if (Object.values(values).some((v) => v !== '')) rows.push({ rowNo: i + 2, values }); // row 1 is the header
  });
  if (!rows.length) throw bad('import-empty', 'The file has headers but no rows to import.');
  if (rows.length > IMPORT_MAX_ROWS) throw bad('import-too-many-rows', `A file can have at most ${IMPORT_MAX_ROWS} rows; this one has ${rows.length}. Split it into smaller files.`);
  return rows;
}

/** Reads .xlsx (first sheet) or .csv, detected from the content. */
export async function readSpreadsheet(buf: Buffer, columns: readonly ImportColumn[]): Promise<RawRow[]> {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw bad('import-unreadable', 'This Excel file could not be read. Save it again as .xlsx and retry.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw bad('import-empty', 'The workbook has no sheets.');
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      if (n > IMPORT_MAX_ROWS + 50) return;
      const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
      grid[n - 1] = vals;
    });
    const [header = [], ...body] = Array.from(grid, (r) => r ?? []);
    return mapRows(header, body, columns);
  }
  const text = buf.toString('utf8').replace(/^﻿/, '');
  if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw bad('import-file-type', 'Upload an Excel (.xlsx) or CSV file.');
  let grid: string[][];
  try {
    grid = parseCsv(text, { relax_column_count: true, skip_empty_lines: false, trim: false, bom: true }) as string[][];
  } catch {
    throw bad('import-unreadable', 'This CSV file could not be read. Check that values with commas are in quotes.');
  }
  const [header = [], ...body] = grid;
  return mapRows(header, body, columns);
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  h.alignment = { vertical: 'middle' };
  h.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Template: data sheet (headers + one example) and a Help sheet with rules and this institution's valid codes. */
export async function buildTemplate(label: string, columns: readonly ImportColumn[], lists: { title: string; values: string[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduERP';
  const ws = wb.addWorksheet(label.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: Math.max(16, c.header.length + 6, c.example.length + 4) }));
  styleHeader(ws);
  const ex = ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.example])));
  ex.font = { italic: true, color: { argb: 'FF6B7186' } };

  const help = wb.addWorksheet('Help');
  help.columns = [{ header: 'Column', key: 'h', width: 22 }, { header: 'Required', key: 'r', width: 11 }, { header: 'What to enter', key: 'w', width: 70 }];
  styleHeader(help);
  for (const c of columns) help.addRow({ h: c.header, r: c.required ? 'Yes' : 'No', w: c.help });
  help.addRow({});
  help.addRow({ h: 'Tip', w: 'Replace the grey example row with your data. Keep the header row as it is. Up to 2,000 rows per file.' }).font = { bold: true };
  for (const l of lists) {
    help.addRow({});
    help.addRow({ h: l.title }).font = { bold: true, color: { argb: 'FF8A6A2C' } };
    for (const v of l.values) help.addRow({ w: v });
  }
  help.getColumn('h').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_SOFT } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Generic sheet writer (exports and error reports). */
export async function buildSheet(title: string, headers: string[], rows: (string | number | null)[][], highlightLast = false): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduERP';
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: Math.min(60, Math.max(14, h.length + 4, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
  styleHeader(ws);
  for (const r of rows) {
    const row = ws.addRow(r);
    if (highlightLast && r[r.length - 1]) row.getCell(r.length).font = { color: { argb: 'FFB42318' } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV with a BOM so Excel opens Kannada and ₹ correctly; formula-like cells are neutralised. */
export function buildCsv(headers: string[], rows: (string | number | null)[][]): Buffer {
  const esc = (v: string | number | null) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV/formula injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return Buffer.from('﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n', 'utf8');
}
