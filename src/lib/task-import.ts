import { dateInputToIso } from './dates';
import type { ProjectCategory, ProjectColumn, SubtaskStatus, TaskPriority } from './domain';
import type { ImportTaskRowInput } from './kanban-service';

/**
 * Turns a coach's spreadsheet of predefined tasks into rows the
 * `importProjectTasks` callable accepts. The sheet is untrusted: every cell is
 * read as plain text, the header is matched by position (never used as an
 * object key), and each row reports its problems so the preview shows exactly
 * what will and will not be imported. The server re-validates all of it.
 */

/** Mirrors `DASHBOARD_AREAS` in functions/src/phase7.ts; the server rejects any other id. */
export const TASK_AREAS = [
  { id: 'innovation-project', label: 'Innovation project' },
  { id: 'robot-design', label: 'Robot design' },
  { id: 'robot-game', label: 'Robot game' },
  { id: 'core-values', label: 'Core values' }
] as const;
export type TaskAreaId = typeof TASK_AREAS[number]['id'];

/** Matches the server's per-import cap (one board column page). */
export const MAX_IMPORT_ROWS = 50;
export const MAX_IMPORT_FILE_BYTES = 1_000_000;
export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_COLUMNS = 20;
const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_LABEL_LENGTH = 40;
const MAX_EXTRA_LABELS = 10;

export type ImportField = 'type' | 'title' | 'description' | 'category' | 'area' | 'status' | 'priority' | 'assignee' | 'startDate' | 'endDate' | 'dueDate' | 'week' | 'labels';

export const IMPORT_FIELDS: Array<{ field: ImportField; label: string; required: boolean; aliases: string[] }> = [
  { field: 'type', label: 'Type', required: false, aliases: ['type', 'row type', 'item type', 'level'] },
  // "Task Description" is the standard template's title column: it is the
  // sentence describing the work, not a long-form body, so it maps to Title.
  { field: 'title', label: 'Title', required: true, aliases: ['title', 'task', 'task name', 'task title', 'task description', 'name', 'summary', 'item'] },
  { field: 'description', label: 'Description', required: false, aliases: ['description', 'details', 'detail', 'notes', 'note'] },
  // "Category" is the board group a coach invents; the judging area is separate
  // and fixed, so each keeps its own aliases and neither steals the other's header.
  { field: 'category', label: 'Category', required: false, aliases: ['category', 'group', 'board group', 'workstream', 'phase', 'module', 'section'] },
  { field: 'area', label: 'Area', required: false, aliases: ['area', 'judging area', 'fll area', 'track'] },
  { field: 'status', label: 'Status', required: false, aliases: ['status', 'column', 'board column', 'state', 'stage'] },
  { field: 'priority', label: 'Priority', required: false, aliases: ['priority', 'importance'] },
  { field: 'assignee', label: 'Assignee', required: false, aliases: ['assignee', 'owner', 'person', 'assigned to', 'responsible', 'who'] },
  { field: 'startDate', label: 'Start date', required: false, aliases: ['start', 'start date', 'starts', 'begin', 'begins', 'planned start'] },
  { field: 'endDate', label: 'End date', required: false, aliases: ['end', 'end date', 'ends', 'finish', 'finish date', 'planned end'] },
  { field: 'dueDate', label: 'Due date', required: false, aliases: ['due', 'due date', 'deadline', 'due on', 'date', 'target date'] },
  { field: 'week', label: 'Week', required: false, aliases: ['week', 'week number', 'wk', 'sprint'] },
  { field: 'labels', label: 'Labels', required: false, aliases: ['labels', 'label', 'tags', 'tag'] }
];

/**
 * Columns a plan carries for its own bookkeeping. They are recognised so the
 * preview does not report them as ignored, but nothing is imported from them:
 * the board mints its own ids.
 */
export const IGNORED_HEADERS = ['task id', 'id', 'ref', 'reference', 'row'];

/**
 * Status words a plan uses, mapped to the columns a First Pit board starts
 * with. A board whose columns are named differently still matches by name;
 * this is the fallback for the words plans use instead.
 */
const STATUS_ALIASES = new Map<string, string>([
  ['not started', 'todo'], ['todo', 'todo'], ['to do', 'todo'], ['open', 'todo'], ['backlog', 'todo'], ['new', 'todo'],
  ['in progress', 'inProgress'], ['inprogress', 'inProgress'], ['doing', 'inProgress'], ['started', 'inProgress'], ['working on it', 'inProgress'], ['wip', 'inProgress'],
  ['review', 'review'], ['in review', 'review'], ['testing', 'review'], ['blocked', 'review'],
  ['done', 'completed'], ['complete', 'completed'], ['completed', 'completed'], ['finished', 'completed'], ['closed', 'completed']
]);

/**
 * The four categories the standard template ships map one-to-one onto the
 * judging areas, so a sheet that names them needs no Area column: the dashboard
 * fills in from the category alone.
 */
const CATEGORY_AREA_HINTS: Array<{ match: RegExp; area: TaskAreaId }> = [
  { match: /core value|project mgmt|project management|teamwork/i, area: 'core-values' },
  { match: /innovation/i, area: 'innovation-project' },
  { match: /robot design|build|mechanical|programming|code/i, area: 'robot-design' },
  { match: /robot game|mission/i, area: 'robot-game' }
];

export function areaFromCategory(category: string): TaskAreaId | null {
  return CATEGORY_AREA_HINTS.find((hint) => hint.match.test(category))?.area ?? null;
}

/** `week-01` sorts and groups; a bare `1` would sit next to `10`. */
export function weekLabel(value: string): string | null {
  const week = Number(value.trim().replace(/^week\s*/i, ''));
  if (!Number.isInteger(week) || week < 1 || week > 99) return null;
  return `week-${String(week).padStart(2, '0')}`;
}

export const SUBTASK_ROW_ALIASES = ['subtask', 'sub task', 'sub-task', 'subitem', 'sub item', 'sub-item', 'child', 'step'];
export const SUBTASK_STATUS_ALIASES = new Map<string, SubtaskStatus>([
  ['todo', 'todo'], ['to do', 'todo'], ['not started', 'todo'], ['open', 'todo'], ['backlog', 'todo'],
  ['inprogress', 'inProgress'], ['in progress', 'inProgress'], ['working on it', 'inProgress'], ['doing', 'inProgress'], ['started', 'inProgress'],
  ['done', 'done'], ['complete', 'done'], ['completed', 'done'], ['finished', 'done']
]);

/** Header order shared by the .xlsx template and the CSV fallback. */
export const IMPORT_TEMPLATE_HEADERS = ['Type', 'Title', 'Description', 'Category', 'Area', 'Status', 'Priority', 'Assignee', 'Start date', 'End date', 'Due date', 'Labels'] as const;

/**
 * The example rows both templates carry. They show the shape a coach asked
 * about — a category with its tasks, and a task broken into sub-items — rather
 * than season content, which is FIRST's to publish.
 */
export const IMPORT_TEMPLATE_EXAMPLES: string[][] = [
  ['Task', 'Define the problem in one sentence', 'Who has the problem and why it matters', 'Innovation project', 'Innovation project', 'To Do', 'High', '', '2026-09-24', '2026-10-01', '2026-10-01', 'research'],
  ['Task', 'Build the team website', 'Somewhere to show the project', 'Innovation project', 'Innovation project', 'To Do', 'Medium', '', '2026-10-06', '2026-10-20', '2026-10-20', ''],
  ['Subtask', 'Build UI', '', '', '', '', '', '', '', '', '', ''],
  ['Subtask', 'Create login screen', '', '', '', '', '', '', '', '', '', ''],
  ['Subtask', 'Create database', '', '', '', '', '', '', '', '', '', ''],
  ['Task', 'Build the base robot', 'Drive base and sensor mounts', 'Robot build', 'Robot design', 'To Do', 'High', '', '2026-10-01', '2026-10-08', '2026-10-08', 'build'],
  ['Task', 'Run the mission ten times and record failures', '', 'Robot build', 'Robot game', 'To Do', 'Medium', '', '2026-10-09', '2026-10-15', '2026-10-15', 'test'],
  ['Task', 'Agree on team roles', '', 'Team', 'Core values', 'To Do', 'Medium', '', '', '', '', 'roles']
];

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV fallback for anyone who cannot open the .xlsx template. */
export const IMPORT_TEMPLATE_CSV = [IMPORT_TEMPLATE_HEADERS.join(','), ...IMPORT_TEMPLATE_EXAMPLES.map((row) => row.map(csvCell).join(','))].join('\n');

const AREA_ALIASES = new Map<string, TaskAreaId>([
  ['innovation project', 'innovation-project'], ['innovation', 'innovation-project'], ['project', 'innovation-project'], ['ip', 'innovation-project'],
  ['robot design', 'robot-design'], ['design', 'robot-design'], ['engineering', 'robot-design'], ['rd', 'robot-design'],
  ['robot game', 'robot-game'], ['robot', 'robot-game'], ['game', 'robot-game'], ['missions', 'robot-game'], ['rg', 'robot-game'],
  ['core values', 'core-values'], ['core value', 'core-values'], ['cv', 'core-values'], ['teamwork', 'core-values']
]);

const PRIORITY_ALIASES = new Map<string, TaskPriority>([
  ['low', 'low'], ['medium', 'medium'], ['med', 'medium'], ['normal', 'medium'], ['high', 'high'], ['urgent', 'urgent'], ['critical', 'urgent']
]);

export function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-.:]+/g, ' ').trim();
}

export function mapHeaders(headers: string[]) {
  const columns: Partial<Record<ImportField, number>> = {};
  const unmapped: string[] = [];
  headers.slice(0, MAX_SHEET_COLUMNS).forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    const match = IMPORT_FIELDS.find((entry) => columns[entry.field] === undefined && entry.aliases.includes(normalized));
    if (match) columns[match.field] = index;
    else if (!IGNORED_HEADERS.includes(normalized)) unmapped.push(header.trim());
  });
  return { columns, unmapped };
}

/** `null` for a blank cell, `undefined` for a value that names no known area. */
export function parseArea(value: string): TaskAreaId | null | undefined {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  return AREA_ALIASES.get(normalized) ?? (TASK_AREAS.some((area) => area.id === value.trim()) ? value.trim() as TaskAreaId : undefined);
}

export function parsePriority(value: string): TaskPriority | null | undefined {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  return PRIORITY_ALIASES.get(normalized);
}

function calendarIso(year: number, month: number, day: number): string | undefined {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || year < 2000 || year > 2100) return undefined;
  return dateInputToIso(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) ?? undefined;
}

/**
 * Accepts `yyyy-mm-dd` (what the spreadsheet reader emits for date cells), a
 * full ISO timestamp, or US `m/d/yyyy`. The date is anchored to local midnight,
 * matching the board's own date picker. `undefined` means unparseable.
 */
export function parseDueDate(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return calendarIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return calendarIso(Number(us[3]), Number(us[1]), Number(us[2]));
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : calendarIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  return undefined;
}

export type ImportRow = {
  /** 1-based row number in the sheet, so a coach can find it. */
  line: number;
  /** A subtask row attaches to the nearest task row above it. */
  kind: 'task' | 'subtask';
  title: string;
  description: string;
  category: string;
  area: TaskAreaId | null;
  /** The board column matched from the Status cell; null means the default column. */
  columnId: string | null;
  columnName: string;
  subtaskStatus: SubtaskStatus;
  priority: TaskPriority;
  startAt: string | null;
  endAt: string | null;
  /** The Assignee cell as written, before the server resolves it. */
  assignee: string;
  /** Resolved user id, once `applyAssigneeMatches` has run. */
  assignedTo: string | null;
  dueAt: string | null;
  labels: string[];
  /** Problems that keep the row out of the import. */
  issues: string[];
  /** Cells that were ignored; the row still imports. */
  warnings: string[];
};

export type ImportPreview = {
  rows: ImportRow[];
  missingTitleColumn: boolean;
  unmappedHeaders: string[];
  /** The sheet had more data rows than the reader will look at. */
  truncated: boolean;
  /** Category names the sheet uses that the board does not have yet. */
  newCategories: string[];
};

/** What the board offers, so Status and Category cells can be matched by name. */
export type ImportContext = { columns: ProjectColumn[]; categories: ProjectCategory[] };

export function matchColumn(columns: ProjectColumn[], value: string): ProjectColumn | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  return columns.find((column) => normalizeHeader(column.name) === normalized || column.id.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

export function parseRowKind(value: string): 'task' | 'subtask' {
  return SUBTASK_ROW_ALIASES.includes(normalizeHeader(value)) ? 'subtask' : 'task';
}

export function parseSubtaskStatus(value: string): SubtaskStatus | null | undefined {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  return SUBTASK_STATUS_ALIASES.get(normalized);
}

export function buildImportPreview(table: unknown[][], context: ImportContext = { columns: [], categories: [] }): ImportPreview {
  const cellsOf = (row: unknown[]) => row.slice(0, MAX_SHEET_COLUMNS).map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()));
  const headerIndex = table.findIndex((row) => Array.isArray(row) && cellsOf(row).some(Boolean));
  if (headerIndex < 0) return { rows: [], missingTitleColumn: true, unmappedHeaders: [], truncated: false, newCategories: [] };
  const { columns, unmapped } = mapHeaders(cellsOf(table[headerIndex]));
  if (columns.title === undefined) return { rows: [], missingTitleColumn: true, unmappedHeaders: unmapped, truncated: false, newCategories: [] };
  const knownCategories = new Set(context.categories.map((category) => normalizeHeader(category.name)));
  const newCategories: string[] = [];
  let sawTaskRow = false;

  const dataRows = table.slice(headerIndex + 1);
  const rows: ImportRow[] = [];
  dataRows.slice(0, MAX_SHEET_ROWS).forEach((raw, offset) => {
    if (!Array.isArray(raw)) return;
    const cells = cellsOf(raw);
    if (!cells.some(Boolean)) return;
    const cell = (field: ImportField) => (columns[field] === undefined ? '' : cells[columns[field]] ?? '');
    const issues: string[] = [];
    const warnings: string[] = [];

    const title = cell('title');
    if (!title) issues.push('Missing a title.');
    else if (title.length > MAX_TITLE_LENGTH) issues.push(`Title is longer than ${MAX_TITLE_LENGTH} characters.`);
    const description = cell('description');
    if (description.length > MAX_DESCRIPTION_LENGTH) issues.push(`Description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`);

    const kind = parseRowKind(cell('type'));
    if (kind === 'subtask' && !sawTaskRow) issues.push('A subtask row must follow the task it belongs to.');
    if (kind === 'task') sawTaskRow = true;

    const category = cell('category');
    if (category.length > 60) issues.push('Category name is longer than 60 characters.');
    else if (kind === 'task' && category && !knownCategories.has(normalizeHeader(category)) && !newCategories.some((entry) => normalizeHeader(entry) === normalizeHeader(category))) {
      newCategories.push(category);
    }

    const statusCell = cell('status');
    const aliasColumnId = STATUS_ALIASES.get(normalizeHeader(statusCell));
    const matchedColumn = matchColumn(context.columns, statusCell)
      ?? (aliasColumnId ? context.columns.find((column) => column.id === aliasColumnId) ?? null : null);
    if (kind === 'task' && statusCell && !matchedColumn) warnings.push(`Status “${statusCell}” is not a column on this board; using the chosen column.`);
    const subtaskStatus = parseSubtaskStatus(statusCell);
    if (kind === 'subtask' && subtaskStatus === undefined) warnings.push(`Status “${statusCell}” is not a subtask status; using To do.`);

    const assignee = cell('assignee');
    if (assignee.length > 254) {
      warnings.push('Assignee is too long to match; left unassigned.');
    }

    let area = parseArea(cell('area'));
    if (area === undefined) warnings.push(`Area “${cell('area')}” is not a judging area, so no area label is added.`);
    // A sheet that names its categories after the judging areas — as the
    // standard template does — needs no Area column at all.
    if (!area && category) area = areaFromCategory(category);
    const priority = parsePriority(cell('priority'));
    if (priority === undefined) warnings.push(`Priority “${cell('priority')}” is not recognised; using medium.`);
    const dueAt = parseDueDate(cell('dueDate'));
    if (dueAt === undefined) warnings.push(`Due date “${cell('dueDate')}” is not a date; left empty.`);
    const startAt = parseDueDate(cell('startDate'));
    if (startAt === undefined) warnings.push(`Start date “${cell('startDate')}” is not a date; left empty.`);
    const endAt = parseDueDate(cell('endDate'));
    if (endAt === undefined) warnings.push(`End date “${cell('endDate')}” is not a date; left empty.`);
    if (startAt && endAt && new Date(startAt).getTime() > new Date(endAt).getTime()) {
      warnings.push('End date is before the start date; both are kept as written.');
    }

    const labels: string[] = [];
    const week = cell('week') ? weekLabel(cell('week')) : null;
    if (cell('week') && !week) warnings.push(`Week “${cell('week')}” is not a week number, so no week label is added.`);
    if (week) labels.push(week);
    for (const label of cell('labels').split(/[,;]/).map((entry) => entry.trim()).filter(Boolean)) {
      if (label.length > MAX_LABEL_LENGTH) warnings.push(`Label “${label.slice(0, 20)}…” is too long and was skipped.`);
      else if (label.includes('/')) warnings.push(`Label “${label}” contains “/” and was skipped.`);
      else if (!labels.includes(label) && label !== area) labels.push(label);
    }
    if (labels.length > MAX_EXTRA_LABELS) warnings.push(`Only the first ${MAX_EXTRA_LABELS} labels are kept.`);

    rows.push({
      line: headerIndex + offset + 2,
      kind,
      title,
      description,
      category,
      area: area ?? null,
      columnId: matchedColumn?.id ?? null,
      columnName: matchedColumn?.name ?? '',
      subtaskStatus: subtaskStatus ?? 'todo',
      priority: priority ?? 'medium',
      assignee: assignee.length > 254 ? '' : assignee,
      assignedTo: null,
      dueAt: dueAt ?? null,
      startAt: startAt ?? null,
      endAt: endAt ?? null,
      labels: labels.slice(0, MAX_EXTRA_LABELS),
      issues,
      warnings
    });
  });
  return { rows, missingTitleColumn: false, unmappedHeaders: unmapped, truncated: dataRows.length > MAX_SHEET_ROWS, newCategories };
}

/** Distinct assignee cells, in sheet order, for one `resolveImportAssignees` call. */
export function assigneeLookups(preview: ImportPreview): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of preview.rows) {
    const key = row.assignee.trim().toLowerCase();
    if (!row.assignee.trim() || seen.has(key)) continue;
    seen.add(key);
    values.push(row.assignee.trim());
  }
  return values;
}

export type AssigneeMatch = { value: string; userId: string | null; displayName: string | null; reason: 'matched' | 'unknown' | 'ambiguous' | 'parent' };

/**
 * Folds the server's roster matches back into the preview. An unmatched name
 * never blocks a row — the card imports unassigned, with the reason shown — so
 * a typo in one cell cannot cost a coach the whole import.
 */
export function applyAssigneeMatches(preview: ImportPreview, matches: AssigneeMatch[]): ImportPreview {
  const byValue = new Map(matches.map((match) => [match.value.trim().toLowerCase(), match]));
  return {
    ...preview,
    rows: preview.rows.map((row) => {
      const value = row.assignee.trim();
      if (!value) return { ...row, assignedTo: null };
      const match = byValue.get(value.toLowerCase());
      if (match?.userId) return { ...row, assignedTo: match.userId };
      const reason = match?.reason === 'ambiguous'
        ? `“${value}” matches more than one teammate, so this row imports unassigned.`
        : match?.reason === 'parent'
          ? `“${value}” is a parent on this team. Parents can follow the tracker but cannot be assigned tasks, so this row imports unassigned.`
          : `“${value}” is not on this team, so this row imports unassigned.`;
      return { ...row, assignedTo: null, warnings: [...row.warnings, reason] };
    })
  };
}

export function importableRows(preview: ImportPreview): ImportRow[] {
  return preview.rows.filter((row) => row.issues.length === 0);
}

/** Task rows only; a subtask is carried inside its parent, not imported alone. */
export function importableTaskCount(preview: ImportPreview): number {
  return importableRows(preview).filter((row) => row.kind === 'task').length;
}

let subtaskSequence = 0;

/**
 * Flattens the previewed sheet into the payload: each task row becomes a card,
 * and the subtask rows following it become its sub-items. Sub-item ids are
 * generated here because the sheet has none to give.
 */
export function toImportInput(rows: ImportRow[]): ImportTaskRowInput[] {
  const tasks: ImportTaskRowInput[] = [];
  for (const row of rows) {
    if (row.kind === 'subtask') {
      const parent = tasks.at(-1);
      if (!parent) continue;
      subtaskSequence += 1;
      parent.subtasks = [...(parent.subtasks ?? []), {
        id: `sub-${Date.now().toString(36)}-${subtaskSequence.toString(36)}`,
        title: row.title,
        status: row.subtaskStatus,
        assignedTo: row.assignedTo,
        dueAt: row.dueAt
      }];
      continue;
    }
    tasks.push({
      title: row.title,
      ...(row.description ? { description: row.description } : {}),
      priority: row.priority,
      area: row.area,
      labels: row.labels,
      dueAt: row.dueAt,
      startAt: row.startAt,
      endAt: row.endAt,
      assignedTo: row.assignedTo,
      columnId: row.columnId,
      categoryName: row.category || null,
      subtasks: []
    });
  }
  return tasks;
}

export function areaLabel(area: TaskAreaId | null): string {
  return TASK_AREAS.find((entry) => entry.id === area)?.label ?? '—';
}
