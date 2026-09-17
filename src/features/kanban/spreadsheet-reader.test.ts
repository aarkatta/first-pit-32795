import { describe, expect, it } from 'vitest';
import { MAX_SHEET_COLUMNS } from '@/lib/task-import';
import { capRows, cellText, pickTaskSheet, readSpreadsheet, spreadsheetKind } from './spreadsheet-reader';

describe('spreadsheetKind', () => {
  it('accepts csv and xlsx by extension or MIME type', () => {
    expect(spreadsheetKind({ name: 'Tasks.CSV', type: '' })).toBe('csv');
    expect(spreadsheetKind({ name: 'export', type: 'text/csv' })).toBe('csv');
    expect(spreadsheetKind({ name: 'tracker.xlsx', type: '' })).toBe('xlsx');
    expect(spreadsheetKind({ name: 'tracker.xls', type: 'application/vnd.ms-excel' })).toBeNull();
  });
});

describe('cellText', () => {
  it('formats Excel dates on the UTC calendar and stringifies the rest', () => {
    expect(cellText(new Date(Date.UTC(2026, 9, 5)))).toBe('2026-10-05');
    expect(cellText(new Date(Number.NaN))).toBe('');
    expect(cellText(null)).toBe('');
    expect(cellText(12)).toBe('12');
    expect(cellText(true)).toBe('true');
    expect(cellText('x'.repeat(5000))).toHaveLength(4001);
  });
});

describe('capRows', () => {
  it('bounds columns and replaces non-array rows', () => {
    const rows = capRows([Array.from({ length: MAX_SHEET_COLUMNS + 5 }, (_, index) => index), 'bad']);
    expect(rows[0]).toHaveLength(MAX_SHEET_COLUMNS);
    expect(rows[1]).toEqual([]);
  });
});

describe('readSpreadsheet', () => {
  it('parses a CSV with quoted commas and keeps blank lines for row numbering', async () => {
    const file = new File(['Title,Description\n"Build, then test",Base robot\n\nProgram,\n'], 'tasks.csv', { type: 'text/csv' });
    const rows = await readSpreadsheet(file);
    expect(rows[0]).toEqual(['Title', 'Description']);
    expect(rows[1]).toEqual(['Build, then test', 'Base robot']);
    expect(rows[3]).toEqual(['Program', '']);
  });

  it('rejects unsupported and oversized files before parsing', async () => {
    await expect(readSpreadsheet(new File(['x'], 'tasks.xls'))).rejects.toThrow('.xlsx or .csv');
    await expect(readSpreadsheet(new File(['x'.repeat(1_000_001)], 'tasks.csv'))).rejects.toThrow('larger than 1 MB');
  });

  it('explains a file that is not really a spreadsheet', async () => {
    await expect(readSpreadsheet(new File(['not a zip'], 'tasks.xlsx'))).rejects.toThrow('could not be opened');
  });
});

describe('choosing the sheet to import', () => {
  const plan = {
    name: 'FLL Project Plan',
    rows: [['Task ID', 'Week', 'Category', 'Task Description'], ['FLL-W01-01', '1', 'Robot Game', 'Build mission models']]
  };
  const guide = { name: 'How to use', rows: [['First Pit — standard FLL task template'], ['1. Fill in Assignee and Status.']] };

  it('skips an instructions sheet and takes the one with a task header', () => {
    // The shipped template used to fail here: its guide sheet came first, and
    // reading it looked like a workbook with no Title column.
    expect(pickTaskSheet([guide, plan])?.name).toBe('FLL Project Plan');
    expect(pickTaskSheet([plan, guide])?.name).toBe('FLL Project Plan');
  });

  it('falls back to the first sheet when none has a recognisable header', () => {
    expect(pickTaskSheet([guide, { name: 'Notes', rows: [['just notes']] }])?.name).toBe('How to use');
  });

  it('has nothing to choose from in an empty workbook', () => {
    expect(pickTaskSheet([])).toBeNull();
  });
});
