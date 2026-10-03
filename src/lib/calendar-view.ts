import { startOfDay } from './board-view';
import { toDate } from './dates';
import type { KanbanProject, ProjectColumn, TeamGoal, TrackerTask } from './domain';

/**
 * Month-grid maths for the tracker's Calendar tab. The calendar stores nothing:
 * it is the board's own cards and the team's milestones laid out by date, so
 * everything here is a pure function of records another screen already loads.
 */

export type CalendarEntry = {
  /** Unique within the calendar: a task and a milestone may share a document id. */
  key: string;
  kind: 'task' | 'milestone';
  id: string;
  title: string;
  /** Local midnight of the day the entry sits on. */
  day: Date;
  done: boolean;
  color: ProjectColumn['color'] | 'gray';
  assignedTo: string | null;
  /** Where the entry opens: the card on the board, or the milestone in its list. */
  href: string;
};

export type CalendarDay = { date: Date; key: string; inMonth: boolean; isToday: boolean };

const DAYS_PER_WEEK = 7;

/** Local-time yyyy-mm-dd, the key entries are grouped under. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(month: Date, count: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + count, 1);
}

export function monthLabel(month: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
}

/** Sunday-first weekday headings, in the viewer's language. */
export function weekdayLabels(): string[] {
  const format = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => format.format(new Date(2023, 0, 1 + index)));
}

/**
 * Whole weeks covering the month, Sunday first, padded with the neighbouring
 * months' days so every row has seven cells.
 */
export function monthGrid(month: Date, now: Date): CalendarDay[] {
  const first = startOfMonth(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const leading = first.getDay();
  const cells = Math.ceil((leading + daysInMonth) / DAYS_PER_WEEK) * DAYS_PER_WEEK;
  const todayKey = dayKey(now);
  return Array.from({ length: cells }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), index - leading + 1);
    const key = dayKey(date);
    return { date, key, inMonth: date.getMonth() === first.getMonth(), isToday: key === todayKey };
  });
}

/**
 * The day a card belongs on: its deadline, else the end of its planned window,
 * else the day work starts. A card with none of the three is not on the calendar.
 */
export function taskCalendarDate(task: TrackerTask): Date | null {
  return toDate(task.dueAt) ?? toDate(task.endAt) ?? toDate(task.startAt);
}

export function calendarEntries(tasks: TrackerTask[], goals: TeamGoal[], project: KanbanProject | null): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const task of tasks) {
    const date = taskCalendarDate(task);
    if (!date) continue;
    const category = project?.categories.find((entry) => entry.id === task.categoryId);
    const search = new URLSearchParams({ ...(project ? { project: project.id } : {}), task: task.id });
    entries.push({
      key: `task-${task.id}`,
      kind: 'task',
      id: task.id,
      title: task.title,
      day: startOfDay(date),
      done: task.status === 'completed',
      color: category?.color ?? 'gray',
      assignedTo: task.assignedTo,
      href: `/coordination?${search.toString()}`
    });
  }
  for (const goal of goals) {
    const date = toDate(goal.dueAt);
    if (!date || goal.status === 'archived') continue;
    entries.push({
      key: `milestone-${goal.id}`,
      kind: 'milestone',
      id: goal.id,
      title: goal.title,
      day: startOfDay(date),
      done: goal.status === 'completed',
      color: 'purple',
      assignedTo: null,
      href: `/milestones?goal=${encodeURIComponent(goal.id)}`
    });
  }
  return entries;
}

/** Entries by `dayKey`, milestones first and then by title, so a day reads the same on every render. */
export function groupEntriesByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.day);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  for (const list of byDay.values()) {
    list.sort((first, second) => (first.kind === second.kind ? first.title.localeCompare(second.title) : first.kind === 'milestone' ? -1 : 1));
  }
  return byDay;
}

/** "Only mine" keeps milestones: they belong to the whole team. */
export function filterEntriesForMember(entries: CalendarEntry[], userId: string): CalendarEntry[] {
  return entries.filter((entry) => entry.kind === 'milestone' || entry.assignedTo === userId);
}

export function undatedTaskCount(tasks: TrackerTask[]): number {
  return tasks.filter((task) => !taskCalendarDate(task)).length;
}
