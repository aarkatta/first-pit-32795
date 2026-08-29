import { dateInputToIso, dateInputValue, formatDueDate, toDate } from './dates';
import type { KanbanProject, ProjectColumn, TaskPriority, TrackerTask } from './domain';

// Re-exported so the board's consumers keep importing their date helpers from one place.
export { toDate, formatDueDate, dateInputValue, dateInputToIso };

/** Palette shared by group headers, status cells, and summary bars. */
export type BoardColor = ProjectColumn['color'] | 'red' | 'yellow' | 'gray';

export type BoardGroupBy = 'column' | 'person' | 'priority' | 'dueWindow' | 'label';
export type BoardSortKey = 'manual' | 'title' | 'priority' | 'dueAt' | 'person';
export type BoardFieldId = 'person' | 'status' | 'priority' | 'dueAt' | 'timeline' | 'labels' | 'files';

export type BoardSort = { key: BoardSortKey; direction: 'asc' | 'desc' };
export type BoardFilters = { query: string; person: string; priority: string; label: string; due: string };
export type BoardGroup = { id: string; title: string; color: BoardColor; tasks: TrackerTask[] };
export type BoardSummarySegment = { id: string; label: string; color: BoardColor; count: number; percent: number };
export type BoardSummary = { segments: BoardSummarySegment[]; total: number; done: number };
export type TimelineSpan = { start: Date; end: Date; label: string };
export type TimelineBounds = { start: number; end: number };
export type DueTone = 'none' | 'overdue' | 'today' | 'soon' | 'later';

export const emptyBoardFilters: BoardFilters = { query: '', person: '', priority: '', label: '', due: '' };
export const defaultBoardSort: BoardSort = { key: 'manual', direction: 'asc' };

export const BOARD_FIELDS: { id: BoardFieldId; label: string }[] = [
  { id: 'person', label: 'Person' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'dueAt', label: 'Date' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'labels', label: 'Labels' },
  { id: 'files', label: 'Files' }
];

export const BOARD_GROUP_OPTIONS: { id: BoardGroupBy; label: string }[] = [
  { id: 'column', label: 'Status group' },
  { id: 'person', label: 'Person' },
  { id: 'priority', label: 'Priority' },
  { id: 'dueWindow', label: 'Due window' },
  { id: 'label', label: 'Label' }
];

export const BOARD_SORT_OPTIONS: { id: BoardSortKey; label: string }[] = [
  { id: 'manual', label: 'Board order' },
  { id: 'title', label: 'Item name' },
  { id: 'priority', label: 'Priority' },
  { id: 'dueAt', label: 'Due date' },
  { id: 'person', label: 'Person' }
];

export const PRIORITY_META: Record<TaskPriority, { label: string; color: BoardColor; rank: number }> = {
  urgent: { label: 'Urgent', color: 'red', rank: 0 },
  high: { label: 'High', color: 'orange', rank: 1 },
  medium: { label: 'Medium', color: 'blue', rank: 2 },
  low: { label: 'Low', color: 'gray', rank: 3 }
};

const AVATAR_TONES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 7;

export function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function boardColumn(project: KanbanProject | null, columnId: string | undefined): ProjectColumn | null {
  if (!project || !columnId) return null;
  return project.columns.find((column) => column.id === columnId) ?? null;
}

export function initials(userId: string | null | undefined): string {
  const trimmed = (userId ?? '').trim();
  if (!trimmed) return '–';
  // An email identifies someone by its local part; the domain is noise.
  const local = trimmed.includes('@') ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed;
  const words = local.split(/[\s._-]+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0] ?? trimmed).slice(0, 2).toUpperCase();
}

/** Stable per-person avatar tint so the same member keeps one colour across groups. */
export function avatarTone(userId: string | null | undefined): number {
  const trimmed = (userId ?? '').trim();
  if (!trimmed) return 0;
  let hash = 0;
  for (const character of trimmed) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return hash % AVATAR_TONES;
}

export function dueTone(date: Date | null, now: Date): DueTone {
  if (!date) return 'none';
  const today = startOfDay(now).getTime();
  const target = startOfDay(date).getTime();
  if (target < today) return 'overdue';
  if (target === today) return 'today';
  return target - today <= SOON_DAYS * DAY_MS ? 'soon' : 'later';
}

export function formatRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = new Intl.DateTimeFormat(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(end);
  return `${startLabel} – ${endLabel}`;
}

/**
 * Tasks carry a due date but no start date, so the planned window runs from when the
 * card was opened to when it is due. Completed cards end on their completion date.
 */
export function timelineSpan(task: TrackerTask): TimelineSpan | null {
  const due = toDate(task.dueAt);
  const completed = toDate(task.completedAt);
  const end = due ?? completed;
  if (!end) return null;
  const created = toDate(task.createdAt);
  const start = created && created.getTime() < end.getTime() ? created : new Date(end.getTime() - DAY_MS);
  return { start, end, label: formatRange(start, end) };
}

export function timelineBounds(tasks: TrackerTask[]): TimelineBounds | null {
  const spans = tasks.map(timelineSpan).filter((span): span is TimelineSpan => span !== null);
  if (!spans.length) return null;
  const start = Math.min(...spans.map((span) => span.start.getTime()));
  const end = Math.max(...spans.map((span) => span.end.getTime()));
  return { start, end: end === start ? start + DAY_MS : end };
}

/** Bar geometry as percentages of the group's own timeline window. */
export function timelineOffsets(span: TimelineSpan, bounds: TimelineBounds): { left: number; width: number } {
  const total = bounds.end - bounds.start;
  if (total <= 0) return { left: 0, width: 100 };
  const left = ((span.start.getTime() - bounds.start) / total) * 100;
  const width = ((span.end.getTime() - span.start.getTime()) / total) * 100;
  return { left: Math.max(0, Math.min(100, left)), width: Math.max(6, Math.min(100 - Math.max(0, left), width)) };
}

export function matchesBoardFilters(task: TrackerTask, filters: BoardFilters, now: Date): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query && !`${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase().includes(query)) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.person === 'unassigned' && task.assignedTo) return false;
  if (filters.person && filters.person !== 'unassigned' && task.assignedTo !== filters.person) return false;
  if (filters.label && !task.labels.includes(filters.label)) return false;
  if (filters.due) {
    const tone = dueTone(toDate(task.dueAt), now);
    if (filters.due === 'overdue' && tone !== 'overdue') return false;
    if (filters.due === 'today' && tone !== 'today') return false;
    if (filters.due === 'week' && !['overdue', 'today', 'soon'].includes(tone)) return false;
    if (filters.due === 'none' && tone !== 'none') return false;
  }
  return true;
}

export function activeFilterCount(filters: BoardFilters): number {
  return [filters.person, filters.priority, filters.label, filters.due].filter(Boolean).length;
}

function comparePrimitive(a: number | string, b: number | string): number {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return Number(a) - Number(b);
}

export function sortBoardTasks(tasks: TrackerTask[], sort: BoardSort): TrackerTask[] {
  const factor = sort.direction === 'desc' ? -1 : 1;
  return [...tasks].sort((first, second) => {
    const manual = Number(first.orderKey ?? 0) - Number(second.orderKey ?? 0);
    if (sort.key === 'manual') return manual * factor;
    let result = 0;
    if (sort.key === 'title') result = comparePrimitive(first.title.toLowerCase(), second.title.toLowerCase());
    if (sort.key === 'priority') result = comparePrimitive(PRIORITY_META[first.priority].rank, PRIORITY_META[second.priority].rank);
    if (sort.key === 'person') result = comparePrimitive((first.assignedTo ?? '￿').toLowerCase(), (second.assignedTo ?? '￿').toLowerCase());
    if (sort.key === 'dueAt') {
      // Undated cards always sink to the bottom, in both directions.
      const firstDue = toDate(first.dueAt);
      const secondDue = toDate(second.dueAt);
      if (!firstDue && !secondDue) return manual;
      if (!firstDue) return 1;
      if (!secondDue) return -1;
      result = firstDue.getTime() - secondDue.getTime();
    }
    return result === 0 ? manual : result * factor;
  });
}

export function dueWindow(date: Date | null, now: Date): { id: string; title: string; color: BoardColor; order: number } {
  const tone = dueTone(date, now);
  if (tone === 'overdue') return { id: 'overdue', title: 'Overdue', color: 'red', order: 0 };
  if (tone === 'today') return { id: 'today', title: 'Due today', color: 'orange', order: 1 };
  if (tone === 'soon') return { id: 'soon', title: 'Next 7 days', color: 'blue', order: 2 };
  if (tone === 'later') return { id: 'later', title: 'Later', color: 'purple', order: 3 };
  return { id: 'none', title: 'No due date', color: 'gray', order: 4 };
}

export function groupBoardTasks(tasks: TrackerTask[], groupBy: BoardGroupBy, project: KanbanProject | null, now: Date): BoardGroup[] {
  if (groupBy === 'column') {
    // Board columns stay in workflow order and keep showing when empty, like a monday group.
    return (project?.columns ?? []).map((column) => ({
      id: column.id,
      title: column.name,
      color: column.color,
      tasks: tasks.filter((task) => task.columnId === column.id)
    }));
  }

  const buckets = new Map<string, BoardGroup & { order: number }>();
  const push = (id: string, title: string, color: BoardColor, order: number, task: TrackerTask) => {
    const existing = buckets.get(id);
    if (existing) existing.tasks.push(task);
    else buckets.set(id, { id, title, color, order, tasks: [task] });
  };

  for (const task of tasks) {
    if (groupBy === 'person') {
      const person = task.assignedTo ?? '';
      push(person || 'unassigned', person || 'Unassigned', person ? 'blue' : 'gray', person ? 0 : 1, task);
    } else if (groupBy === 'priority') {
      const meta = PRIORITY_META[task.priority];
      push(task.priority, meta.label, meta.color, meta.rank, task);
    } else if (groupBy === 'dueWindow') {
      const window = dueWindow(toDate(task.dueAt), now);
      push(window.id, window.title, window.color, window.order, task);
    } else {
      // One row can carry several labels, so it appears under each of them.
      if (!task.labels.length) push('unlabeled', 'No label', 'gray', 1, task);
      else for (const label of task.labels) push(`label:${label}`, label, 'purple', 0, task);
    }
  }

  return [...buckets.values()]
    .sort((first, second) => first.order - second.order || first.title.localeCompare(second.title))
    .map(({ id, title, color, tasks: grouped }) => ({ id, title, color, tasks: grouped }));
}

export function summarizeGroup(tasks: TrackerTask[], project: KanbanProject | null): BoardSummary {
  const total = tasks.length;
  const columns = project?.columns ?? [];
  const segments = columns
    .map((column) => {
      const count = tasks.filter((task) => task.columnId === column.id).length;
      return { id: column.id, label: column.name, color: column.color as BoardColor, count, percent: total ? (count / total) * 100 : 0 };
    })
    .filter((segment) => segment.count > 0);
  const untracked = total - segments.reduce((sum, segment) => sum + segment.count, 0);
  if (untracked > 0) segments.push({ id: 'other', label: 'Other', color: 'gray', count: untracked, percent: (untracked / total) * 100 });
  const doneColumnId = project?.completedColumnId ?? 'completed';
  return { segments, total, done: tasks.filter((task) => task.columnId === doneColumnId || task.status === 'completed').length };
}

export function boardPeople(tasks: TrackerTask[]): string[] {
  return [...new Set(tasks.map((task) => task.assignedTo).filter((person): person is string => Boolean(person)))].sort();
}

export function boardLabels(tasks: TrackerTask[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.labels))].sort();
}

