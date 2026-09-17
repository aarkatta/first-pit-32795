import { MAX_IMPORT_FILE_BYTES, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, mapHeaders } from '@/lib/task-import';

/**
 * Reads the first sheet of an uploaded .xlsx or .csv into rows of plain text.
 * Both parsers load on demand, so the board bundle does not carry them for
 * sessions that never import. The file is capped before parsing — an .xlsx is
 * a zip and expands in memory — and the output is capped again by rows,
 * columns, and cell length before anything else looks at it.
 */

/** Header and blank-row slack on top of the data-row cap, so truncation is detectable. */
const READ_ROW_LIMIT = MAX_SHEET_ROWS + 20;
/** One past the longest field the importer accepts, so an over-long cell is still flagged. */
const MAX_CELL_LENGTH = 4001;

export type SpreadsheetKind = 'csv' | 'xlsx';

export function spreadsheetKind(file: { name: string; type: string }): SpreadsheetKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') return 'csv';
  if (name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  return null;
}

/**
 * Excel date cells arrive as `Date`s at UTC midnight; formatting with UTC
 * getters keeps "Oct 5" from becoming "Oct 4" west of Greenwich.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, MAX_CELL_LENGTH);
}

export function capRows(rows: unknown[]): string[][] {
  return rows.slice(0, READ_ROW_LIMIT).map((row) => (Array.isArray(row) ? row.slice(0, MAX_SHEET_COLUMNS).map(cellText) : []));
}

async function readCsv(file: File): Promise<unknown[]> {
  const { default: Papa } = await import('papaparse');
  return new Promise((resolve, reject) => {
    // Blank lines are kept so preview row numbers match the file; the preview skips them.
    Papa.parse<unknown[]>(file, {
      preview: READ_ROW_LIMIT,
      dynamicTyping: false,
      complete: (result) => resolve(result.data),
      error: (error) => reject(new Error(`The CSV file could not be read: ${error.message}`))
    });
  });
}

export type NamedSheet = { name: string; rows: string[][] };

/**
 * A workbook rarely has only one sheet: the template ships instructions beside
 * the plan, and teams keep notes, a roster, a legend. Reading whichever sheet
 * happens to be first made an instructions tab look like a missing Title
 * column, so the sheet that actually carries tasks is chosen by its header row.
 */
export function pickTaskSheet(sheets: NamedSheet[]): NamedSheet | null {
  if (!sheets.length) return null;
  const withTasks = sheets.find((sheet) => sheet.rows.some((row) => row.some(Boolean) && mapHeaders(row).columns.title !== undefined));
  // No sheet has a recognisable header: hand back the first so the preview can
  // report the missing Title column against real content.
  return withTasks ?? sheets[0];
}

async function readXlsxSheets(file: File): Promise<NamedSheet[]> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  try {
    const sheets = await readXlsxFile(file) as unknown as Array<{ sheet?: string; data?: unknown[] } | unknown[]>;
    // Older builds hand back the first sheet's rows directly rather than a list
    // of sheets; both shapes are accepted so an upgrade cannot break uploads.
    if (Array.isArray(sheets) && sheets.length && Array.isArray(sheets[0])) {
      return [{ name: 'Sheet1', rows: capRows(sheets as unknown[]) }];
    }
    return (sheets as Array<{ sheet?: string; data?: unknown[] }>).map((sheet, index) => ({
      name: typeof sheet.sheet === 'string' ? sheet.sheet : `Sheet${index + 1}`,
      rows: capRows(Array.isArray(sheet.data) ? sheet.data : [])
    }));
  } catch {
    throw new Error('The spreadsheet could not be opened. Save it as .xlsx and try again.');
  }
}

export async function readSpreadsheet(file: File): Promise<string[][]> {
  const kind = spreadsheetKind(file);
  if (!kind) throw new Error('Choose a .xlsx or .csv file. An older .xls file needs to be saved as .xlsx first.');
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('The file is larger than 1 MB. Remove extra sheets, images, or columns and try again.');
  if (kind === 'csv') return capRows(await readCsv(file));
  const sheet = pickTaskSheet(await readXlsxSheets(file));
  if (!sheet) throw new Error('That workbook has no sheets to read.');
  return sheet.rows;
}
