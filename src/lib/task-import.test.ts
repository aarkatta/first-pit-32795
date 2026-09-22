import { describe, expect, it } from 'vitest';
import {
  IMPORT_TEMPLATE_CSV,
  MAX_SHEET_ROWS,
  applyAssigneeMatches,
  areaLabel,
  assigneeLookups,
  buildImportPreview,
  importableRows,
  mapHeaders,
  normalizeHeader,
  parseArea,
  parseDueDate,
  parsePriority,
  toImportInput
} from './task-import';
import type { ImportContext } from './task-import';

/** A board to match Status and Category cells against. */
const context: ImportContext = {
  columns: [
    { id: 'todo', name: 'To Do', color: 'blue' },
    { id: 'inProgress', name: 'In Progress', color: 'purple' },
    { id: 'completed', name: 'Completed', color: 'green' }
  ],
  categories: [{ id: 'build', name: 'Robot build', color: 'blue', areaId: 'robot-design', goalId: null }]
};

function localDate(value: string | null | undefined) {
  if (!value) return value;
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

describe('header mapping', () => {
  it('normalizes spacing, case, and punctuation', () => {
    expect(normalizeHeader('  Due_Date: ')).toBe('due date');
  });

  it('maps known aliases by position and reports the rest', () => {
    const { columns, unmapped } = mapHeaders(['Task Name', 'Owner', 'Category', 'Deadline', 'Tags', '', 'Notes', 'Importance']);
    // "Owner" is the Assignee column and "Category" is the board group — the
    // judging area has its own header, so neither steals the other's cells.
    expect(columns).toEqual({ title: 0, assignee: 1, category: 2, dueDate: 3, labels: 4, description: 6, priority: 7 });
    expect(unmapped).toEqual([]);
  });

  it('keeps the first column when two headers mean the same field, and ignores __proto__', () => {
    const { columns, unmapped } = mapHeaders(['Title', 'Name', '__proto__']);
    expect(columns.title).toBe(0);
    expect(unmapped).toEqual(['Name', '__proto__']);
    expect(Object.getPrototypeOf(columns)).toBe(Object.prototype);
  });
});

describe('cell parsers', () => {
  it('recognizes judging areas by name, alias, or id', () => {
    expect(parseArea('Robot Game')).toBe('robot-game');
    expect(parseArea('CV')).toBe('core-values');
    expect(parseArea('innovation-project')).toBe('innovation-project');
    expect(parseArea('')).toBeNull();
    expect(parseArea('Marketing')).toBeUndefined();
    expect(areaLabel('robot-design')).toBe('Robot design');
    expect(areaLabel(null)).toBe('—');
  });

  it('recognizes priorities', () => {
    expect(parsePriority('Critical')).toBe('urgent');
    expect(parsePriority('med')).toBe('medium');
    expect(parsePriority(' ')).toBeNull();
    expect(parsePriority('soon')).toBeUndefined();
  });

  it('parses spreadsheet, ISO, and US dates on the local calendar', () => {
    expect(localDate(parseDueDate('2026-10-05'))).toBe('2026-10-5');
    expect(localDate(parseDueDate('10/5/2026'))).toBe('2026-10-5');
    expect(parseDueDate('2026-10-05T12:00:00.000Z')).toEqual(expect.any(String));
    expect(parseDueDate('')).toBeNull();
    expect(parseDueDate('2026-02-30')).toBeUndefined();
    expect(parseDueDate('1999-01-01')).toBeUndefined();
    expect(parseDueDate('next Tuesday')).toBeUndefined();
    expect(parseDueDate('2026-99-99T00:00:00Z')).toBeUndefined();
  });
});

describe('buildImportPreview', () => {
  it('reads the starter spreadsheet cleanly', () => {
    const table = IMPORT_TEMPLATE_CSV.split('\n').map((line) => line.split(','));
    const preview = buildImportPreview(table);
    expect(preview.missingTitleColumn).toBe(false);
    expect(preview.rows).toHaveLength(8);
    expect(preview.rows.every((row) => row.issues.length === 0)).toBe(true);
    expect(preview.rows[0]).toMatchObject({ line: 2, kind: 'task', category: 'Innovation project', area: 'innovation-project', priority: 'high', labels: ['research'] });
    // The template shows a task broken into sub-items, and they follow it.
    expect(preview.rows.slice(2, 5).map((row) => row.kind)).toEqual(['subtask', 'subtask', 'subtask']);
    expect(preview.rows.at(-1)).toMatchObject({ area: 'core-values', dueAt: null });
    // Every category the template names is new to an empty board.
    expect(preview.newCategories).toEqual(['Innovation project', 'Robot build', 'Team']);
  });

  it('skips leading and blank rows and numbers lines as the sheet does', () => {
    const preview = buildImportPreview([[], ['', null], ['Title', 'Area'], ['', ''], ['Build', 'Robot design'], [null, undefined]]);
    expect(preview.rows).toEqual([expect.objectContaining({ line: 5, title: 'Build', area: 'robot-design' })]);
  });

  it('separates blocking issues from ignored cells', () => {
    const preview = buildImportPreview([
      ['Title', 'Description', 'Area', 'Priority', 'Due', 'Labels'],
      ['', 'no title', '', '', '', ''],
      ['Research and/or build', '', '', '', '', ''],
      ['Good row', 'See https://example.com', '', '', '', ''],
      ['x'.repeat(161), '', '', '', '', ''],
      ['Kept', '', 'Marketing', 'soon', 'someday', `build, build, a/b, ${'y'.repeat(41)}, robot-game`],
      ['Area label', '', 'Robot game', '', '', 'robot-game']
    ]);
    const [noTitle, slashTitle, slashDescription, longTitle, kept, areaLabelRow] = preview.rows;
    expect(noTitle.issues).toEqual(['Missing a title.']);
    // "/" is ordinary prose — "Research and/or build", a URL in a description —
    // and the server accepts it in free text, so neither row is blocked.
    expect(slashTitle.issues).toEqual([]);
    expect(slashDescription.issues).toEqual([]);
    expect(longTitle.issues[0]).toMatch(/longer than 160/);
    expect(kept.issues).toEqual([]);
    expect(kept).toMatchObject({ area: null, priority: 'medium', dueAt: null, labels: ['build', 'robot-game'] });
    expect(kept.warnings).toHaveLength(5);
    expect(areaLabelRow.labels).toEqual([]);
    expect(importableRows(preview).map((row) => row.title)).toEqual(['Research and/or build', 'Good row', 'Kept', 'Area label']);
  });

  it('flags an over-long description and caps extra labels', () => {
    const labels = Array.from({ length: 12 }, (_, index) => `l${index}`).join(';');
    const preview = buildImportPreview([['Title', 'Description', 'Labels'], ['Row', 'd'.repeat(4001), labels]]);
    expect(preview.rows[0].issues[0]).toMatch(/Description is longer/);
    expect(preview.rows[0].labels).toHaveLength(10);
    expect(preview.rows[0].warnings).toEqual(['Only the first 10 labels are kept.']);
  });

  it('refuses a sheet without a title column', () => {
    expect(buildImportPreview([['Notes', 'Area'], ['Sam', 'Robot game']])).toMatchObject({ rows: [], missingTitleColumn: true });
    expect(buildImportPreview([])).toMatchObject({ rows: [], missingTitleColumn: true });
  });

  it('caps the number of rows it reads', () => {
    const table = [['Title'], ...Array.from({ length: MAX_SHEET_ROWS + 5 }, (_, index) => [`Task ${index}`])];
    const preview = buildImportPreview(table);
    expect(preview.rows).toHaveLength(MAX_SHEET_ROWS);
    expect(preview.truncated).toBe(true);
  });

  it('ignores non-array rows and stringifies cell values', () => {
    const preview = buildImportPreview([['Title', 'Priority'], 'oops' as unknown as unknown[], [42, 'High']]);
    expect(preview.rows).toEqual([expect.objectContaining({ title: '42', priority: 'high' })]);
  });
});

describe('toImportInput', () => {
  it('sends only validated fields and omits an empty description', () => {
    const preview = buildImportPreview([['Title', 'Description', 'Area'], ['One', '', 'Robot game'], ['Two', 'Details', '']]);
    expect(toImportInput(importableRows(preview))).toEqual([
      { title: 'One', priority: 'medium', area: 'robot-game', labels: [], dueAt: null, startAt: null, endAt: null, assignedTo: null, columnId: null, categoryName: null, subtasks: [] },
      { title: 'Two', description: 'Details', priority: 'medium', area: null, labels: [], dueAt: null, startAt: null, endAt: null, assignedTo: null, columnId: null, categoryName: null, subtasks: [] }
    ]);
  });

  it('carries subtask rows inside the task above them', () => {
    const preview = buildImportPreview([
      ['Type', 'Title', 'Status'],
      ['Task', 'Build the website', 'To Do'],
      ['Subtask', 'Build UI', 'Done'],
      ['Subtask', 'Create login screen', ''],
      ['Task', 'Test the robot', '']
    ], context);
    const rows = toImportInput(importableRows(preview));
    expect(rows).toHaveLength(2);
    expect(rows[0].columnId).toBe('todo');
    expect(rows[0].subtasks?.map((subtask) => [subtask.title, subtask.status])).toEqual([['Build UI', 'done'], ['Create login screen', 'todo']]);
    expect(rows[1].subtasks).toEqual([]);
  });

  it('refuses a subtask row that has no task above it', () => {
    const preview = buildImportPreview([['Type', 'Title'], ['Subtask', 'Orphan step'], ['Task', 'Real task']]);
    expect(preview.rows[0].issues).toContain('A subtask row must follow the task it belongs to.');
    expect(toImportInput(importableRows(preview))).toHaveLength(1);
  });
});

describe('board matching', () => {
  it('matches a Status cell to a board column by name or id, and warns otherwise', () => {
    const preview = buildImportPreview([
      ['Title', 'Status'],
      ['A', 'In Progress'],
      ['B', 'todo'],
      ['C', 'Somewhere else']
    ], context);
    expect(preview.rows[0]).toMatchObject({ columnId: 'inProgress', columnName: 'In Progress' });
    expect(preview.rows[1].columnId).toBe('todo');
    expect(preview.rows[2].columnId).toBeNull();
    expect(preview.rows[2].warnings[0]).toMatch(/not a column on this board/);
  });

  it('reports only the categories the board does not already have, case-insensitively', () => {
    const preview = buildImportPreview([
      ['Title', 'Category'],
      ['A', 'robot build'],
      ['B', 'Outreach'],
      ['C', 'Outreach']
    ], context);
    expect(preview.newCategories).toEqual(['Outreach']);
  });
});

describe('assignee matching', () => {
  const preview = () => buildImportPreview([
    ['Title', 'Assignee'],
    ['A', 'Ada Lovelace'],
    ['B', 'ada@example.com'],
    ['C', '']
  ], context);

  it('collects each distinct assignee cell once, for one server lookup', () => {
    expect(assigneeLookups(preview())).toEqual(['Ada Lovelace', 'ada@example.com']);
  });

  it('applies matches and leaves an unmatched name unassigned with a reason', () => {
    const applied = applyAssigneeMatches(preview(), [
      { value: 'Ada Lovelace', userId: 'ada', displayName: 'Ada Lovelace', reason: 'matched' },
      { value: 'ada@example.com', userId: null, displayName: null, reason: 'unknown' }
    ]);
    expect(applied.rows[0].assignedTo).toBe('ada');
    expect(applied.rows[1].assignedTo).toBeNull();
    expect(applied.rows[1].warnings.at(-1)).toMatch(/is not on this team/);
    expect(applied.rows[2].warnings).toEqual([]);
    // An unmatched name never blocks its row.
    expect(applied.rows.every((row) => row.issues.length === 0)).toBe(true);
  });

  it('explains an ambiguous name rather than guessing between two teammates', () => {
    const applied = applyAssigneeMatches(preview(), [{ value: 'Ada Lovelace', userId: null, displayName: null, reason: 'ambiguous' }]);
    expect(applied.rows[0].warnings.at(-1)).toMatch(/matches more than one teammate/);
  });

  it('explains a parent rather than calling them unknown', () => {
    const applied = applyAssigneeMatches(preview(), [{ value: 'Ada Lovelace', userId: null, displayName: 'Ada Lovelace', reason: 'parent' }]);
    const row = applied.rows.find((entry) => entry.assignee === 'Ada Lovelace');
    expect(row?.assignedTo).toBeNull();
    expect(row?.warnings.join(' ')).toMatch(/is a parent on this team.*cannot be assigned tasks/);
    expect(row?.warnings.join(' ')).not.toMatch(/not on this team/);
  });
});

describe('planned dates', () => {
  it('reads start, end and due dates as three separate columns', () => {
    const preview = buildImportPreview([
      ['Title', 'Start date', 'End date', 'Due date'],
      ['Build the base robot', '2026-10-01', '2026-10-08', '2026-10-10']
    ], context);
    const [row] = toImportInput(importableRows(preview));
    expect(row.startAt?.slice(0, 10)).toBe('2026-10-01');
    expect(row.endAt?.slice(0, 10)).toBe('2026-10-08');
    expect(row.dueAt?.slice(0, 10)).toBe('2026-10-10');
  });

  it('keeps an end date that precedes its start, and says so', () => {
    // Refusing the row would lose the coach's data over what is often a typo in
    // one of the two cells; the warning points at it instead.
    const preview = buildImportPreview([
      ['Title', 'Start date', 'End date'],
      ['Backwards', '2026-10-08', '2026-10-01']
    ], context);
    expect(preview.rows[0].issues).toEqual([]);
    expect(preview.rows[0].warnings.at(-1)).toMatch(/End date is before the start date/);
  });

  it('leaves an unreadable date empty rather than blocking the row', () => {
    const preview = buildImportPreview([['Title', 'Start date'], ['Row', 'whenever']], context);
    expect(preview.rows[0].startAt).toBeNull();
    expect(preview.rows[0].warnings[0]).toMatch(/Start date/);
    expect(preview.rows[0].issues).toEqual([]);
  });
});

