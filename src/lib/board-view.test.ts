import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  avatarTone,
  boardColumn,
  boardLabels,
  boardPeople,
  dateInputToIso,
  dateInputValue,
  dueTone,
  dueWindow,
  emptyBoardFilters,
  formatDueDate,
  formatRange,
  groupBoardTasks,
  initials,
  matchesBoardFilters,
  sortBoardTasks,
  startOfDay,
  summarizeGroup,
  timelineBounds,
  timelineOffsets,
  timelineSpan,
  toDate,
  type BoardFilters
} from './board-view';
import type { KanbanProject, TrackerTask } from './domain';

const now = new Date('2026-03-10T09:00:00Z');

const project: KanbanProject = {
  id: 'project-1',
  teamId: 'team-1',
  createdBy: 'coach-1',
  name: 'Robot build',
  description: '',
  columns: [
    { id: 'todo', name: 'To Do', color: 'blue' },
    { id: 'inProgress', name: 'In Progress', color: 'purple' },
    { id: 'completed', name: 'Completed', color: 'green' }
  ],
  completedColumnId: 'completed',
  archived: false
};

function task(overrides: Partial<TrackerTask> = {}): TrackerTask {
  return {
    id: 'task-1',
    teamId: 'team-1',
    createdBy: 'coach-1',
    title: 'Wire the arm',
    description: '',
    status: 'todo',
    priority: 'medium',
    assignedTo: null,
    watcherUserIds: [],
    goalId: null,
    labels: [],
    checklist: [],
    attachmentFileIds: [],
    historyCount: 0,
    columnId: 'todo',
    orderKey: 1024,
    ...overrides
  };
}

describe('toDate', () => {
  it('reads Firestore timestamps, Dates, and ISO strings, and rejects the rest', () => {
    expect(toDate({ toDate: () => new Date('2026-03-01T00:00:00Z') })?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(toDate(new Date('2026-03-02T00:00:00Z'))?.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(toDate('2026-03-03T00:00:00Z')?.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate({ toDate: () => new Date('nope') })).toBeNull();
  });
});

describe('date helpers', () => {
  it('normalizes to local midnight', () => {
    expect(startOfDay(new Date('2026-03-10T23:45:00')).getHours()).toBe(0);
  });

  it('tones a due date against today', () => {
    expect(dueTone(null, now)).toBe('none');
    expect(dueTone(new Date('2026-03-08T00:00:00'), now)).toBe('overdue');
    expect(dueTone(new Date('2026-03-10T22:00:00'), now)).toBe('today');
    expect(dueTone(new Date('2026-03-14T00:00:00'), now)).toBe('soon');
    expect(dueTone(new Date('2026-04-30T00:00:00'), now)).toBe('later');
  });

  it('formats dates and ranges', () => {
    expect(formatDueDate(null)).toBe('');
    expect(formatDueDate(new Date('2026-03-10T12:00:00'))).toMatch(/10/);
    expect(formatRange(new Date('2026-03-01T12:00:00'), new Date('2026-03-07T12:00:00'))).toMatch(/1 – Mar 7|1 – 7/);
    expect(formatRange(new Date('2026-02-24T12:00:00'), new Date('2026-03-07T12:00:00'))).toMatch(/Feb/);
  });

  it('round-trips a date input value in local time', () => {
    expect(dateInputValue(null)).toBe('');
    const iso = dateInputToIso('2026-03-10');
    expect(dateInputValue(iso)).toBe('2026-03-10');
    expect(dateInputToIso('')).toBeNull();
    expect(dateInputToIso('nonsense')).toBeNull();
  });
});

describe('person presentation', () => {
  it('derives initials from ids, emails, and names', () => {
    expect(initials(null)).toBe('–');
    expect(initials('  ')).toBe('–');
    expect(initials('ada.lovelace')).toBe('AL');
    expect(initials('rk@example.com')).toBe('RK');
    expect(initials('zx9')).toBe('ZX');
  });

  it('gives every person a stable tone inside the palette', () => {
    expect(avatarTone(null)).toBe(0);
    expect(avatarTone('student-1')).toBe(avatarTone('student-1'));
    expect(avatarTone('student-1')).toBeGreaterThanOrEqual(0);
    expect(avatarTone('student-1')).toBeLessThan(6);
  });
});

describe('timeline', () => {
  it('spans creation to due date and falls back to a one-day bar', () => {
    expect(timelineSpan(task())).toBeNull();
    const spanned = timelineSpan(task({ createdAt: '2026-03-01T00:00:00Z', dueAt: '2026-03-08T00:00:00Z' }));
    expect(spanned?.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(spanned?.end.toISOString()).toBe('2026-03-08T00:00:00.000Z');

    const noCreate = timelineSpan(task({ dueAt: '2026-03-08T00:00:00Z' }));
    expect(noCreate?.start.toISOString()).toBe('2026-03-07T00:00:00.000Z');

    const completedOnly = timelineSpan(task({ completedAt: '2026-03-05T00:00:00Z' }));
    expect(completedOnly?.end.toISOString()).toBe('2026-03-05T00:00:00.000Z');

    // A card created after its own due date still renders a bar rather than an inverted one.
    const inverted = timelineSpan(task({ createdAt: '2026-03-09T00:00:00Z', dueAt: '2026-03-08T00:00:00Z' }));
    expect(inverted!.start.getTime()).toBeLessThan(inverted!.end.getTime());
  });

  it('measures group bounds and clamps bar geometry', () => {
    expect(timelineBounds([task()])).toBeNull();
    const bounds = timelineBounds([
      task({ id: 'a', createdAt: '2026-03-01T00:00:00Z', dueAt: '2026-03-05T00:00:00Z' }),
      task({ id: 'b', createdAt: '2026-03-03T00:00:00Z', dueAt: '2026-03-11T00:00:00Z' })
    ])!;
    expect(new Date(bounds.start).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(new Date(bounds.end).toISOString()).toBe('2026-03-11T00:00:00.000Z');

    const span = timelineSpan(task({ createdAt: '2026-03-01T00:00:00Z', dueAt: '2026-03-11T00:00:00Z' }))!;
    expect(timelineOffsets(span, bounds)).toEqual({ left: 0, width: 100 });
    expect(timelineOffsets(span, { start: bounds.start, end: bounds.start }).width).toBe(100);

    // A zero-length span keeps a visible minimum width.
    const point = timelineSpan(task({ createdAt: '2026-03-05T00:00:00Z', dueAt: '2026-03-05T00:00:00Z' }))!;
    expect(timelineOffsets(point, bounds).width).toBeGreaterThanOrEqual(6);
  });

  it('widens a single-instant group so the bar has somewhere to sit', () => {
    const bounds = timelineBounds([task({ createdAt: '2026-03-05T00:00:00Z', dueAt: '2026-03-05T00:00:00Z' })])!;
    expect(bounds.end).toBeGreaterThan(bounds.start);
  });
});

describe('filtering', () => {
  const filters = (overrides: Partial<BoardFilters> = {}): BoardFilters => ({ ...emptyBoardFilters, ...overrides });

  it('passes everything when no filter is set', () => {
    expect(matchesBoardFilters(task(), emptyBoardFilters, now)).toBe(true);
    expect(activeFilterCount(emptyBoardFilters)).toBe(0);
  });

  it('searches title, description, and labels', () => {
    const searchable = task({ title: 'Wire arm', description: 'motor harness', labels: ['electronics'] });
    expect(matchesBoardFilters(searchable, filters({ query: 'HARNESS' }), now)).toBe(true);
    expect(matchesBoardFilters(searchable, filters({ query: 'electronics' }), now)).toBe(true);
    expect(matchesBoardFilters(searchable, filters({ query: 'chassis' }), now)).toBe(false);
  });

  it('filters by person, priority, and label', () => {
    expect(matchesBoardFilters(task({ assignedTo: 'student-1' }), filters({ person: 'student-1' }), now)).toBe(true);
    expect(matchesBoardFilters(task({ assignedTo: 'student-2' }), filters({ person: 'student-1' }), now)).toBe(false);
    expect(matchesBoardFilters(task(), filters({ person: 'unassigned' }), now)).toBe(true);
    expect(matchesBoardFilters(task({ assignedTo: 'student-1' }), filters({ person: 'unassigned' }), now)).toBe(false);
    expect(matchesBoardFilters(task({ priority: 'urgent' }), filters({ priority: 'urgent' }), now)).toBe(true);
    expect(matchesBoardFilters(task({ priority: 'low' }), filters({ priority: 'urgent' }), now)).toBe(false);
    expect(matchesBoardFilters(task({ labels: ['cad'] }), filters({ label: 'cad' }), now)).toBe(true);
    expect(matchesBoardFilters(task(), filters({ label: 'cad' }), now)).toBe(false);
  });

  it('filters by due window', () => {
    const overdue = task({ dueAt: '2026-03-01T00:00:00Z' });
    const today = task({ dueAt: '2026-03-10T15:00:00Z' });
    const soon = task({ dueAt: '2026-03-13T00:00:00Z' });
    const undated = task();
    expect(matchesBoardFilters(overdue, filters({ due: 'overdue' }), now)).toBe(true);
    expect(matchesBoardFilters(today, filters({ due: 'overdue' }), now)).toBe(false);
    expect(matchesBoardFilters(today, filters({ due: 'today' }), now)).toBe(true);
    expect(matchesBoardFilters(soon, filters({ due: 'today' }), now)).toBe(false);
    expect(matchesBoardFilters(soon, filters({ due: 'week' }), now)).toBe(true);
    expect(matchesBoardFilters(undated, filters({ due: 'week' }), now)).toBe(false);
    expect(matchesBoardFilters(undated, filters({ due: 'none' }), now)).toBe(true);
    expect(matchesBoardFilters(soon, filters({ due: 'none' }), now)).toBe(false);
  });

  it('counts only the chip filters, never the search box', () => {
    expect(activeFilterCount(filters({ query: 'arm' }))).toBe(0);
    expect(activeFilterCount(filters({ priority: 'high', due: 'overdue' }))).toBe(2);
  });
});

describe('sorting', () => {
  const a = task({ id: 'a', title: 'Beta', priority: 'low', orderKey: 3072, assignedTo: 'zoe', dueAt: '2026-03-20T00:00:00Z' });
  const b = task({ id: 'b', title: 'alpha', priority: 'urgent', orderKey: 1024, assignedTo: 'ada', dueAt: '2026-03-05T00:00:00Z' });
  const c = task({ id: 'c', title: 'Gamma', priority: 'high', orderKey: 2048 });

  const ids = (list: TrackerTask[]) => list.map((entry) => entry.id);

  it('defaults to board order and honours direction', () => {
    expect(ids(sortBoardTasks([a, b, c], { key: 'manual', direction: 'asc' }))).toEqual(['b', 'c', 'a']);
    expect(ids(sortBoardTasks([a, b, c], { key: 'manual', direction: 'desc' }))).toEqual(['a', 'c', 'b']);
  });

  it('sorts by title case-insensitively', () => {
    expect(ids(sortBoardTasks([a, b, c], { key: 'title', direction: 'asc' }))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by priority rank and by person', () => {
    expect(ids(sortBoardTasks([a, b, c], { key: 'priority', direction: 'asc' }))).toEqual(['b', 'c', 'a']);
    expect(ids(sortBoardTasks([a, b, c], { key: 'person', direction: 'asc' }))).toEqual(['b', 'a', 'c']);
  });

  it('keeps undated cards last in both sort directions', () => {
    expect(ids(sortBoardTasks([a, b, c], { key: 'dueAt', direction: 'asc' }))).toEqual(['b', 'a', 'c']);
    expect(ids(sortBoardTasks([a, b, c], { key: 'dueAt', direction: 'desc' }))).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties with board order', () => {
    const first = task({ id: 'first', title: 'Same', orderKey: 2048 });
    const second = task({ id: 'second', title: 'Same', orderKey: 1024 });
    expect(ids(sortBoardTasks([first, second], { key: 'title', direction: 'asc' }))).toEqual(['second', 'first']);
    const undatedTie = sortBoardTasks([first, second], { key: 'dueAt', direction: 'asc' });
    expect(ids(undatedTie)).toEqual(['second', 'first']);
  });
});

describe('grouping', () => {
  const tasks = [
    task({ id: 'a', columnId: 'todo', assignedTo: 'ada', priority: 'high', labels: ['cad'], dueAt: '2026-03-01T00:00:00Z' }),
    task({ id: 'b', columnId: 'completed', status: 'completed', assignedTo: 'ada', priority: 'low', labels: ['cad', 'robot'] }),
    task({ id: 'c', columnId: 'inProgress', priority: 'high' })
  ];

  it('keeps empty board columns visible and in workflow order', () => {
    const groups = groupBoardTasks(tasks, 'column', project, now);
    expect(groups.map((group) => group.id)).toEqual(['todo', 'inProgress', 'completed']);
    expect(groups[0].color).toBe('blue');
    expect(groups[0].tasks.map((entry) => entry.id)).toEqual(['a']);
  });

  it('returns nothing to group when there is no project', () => {
    expect(groupBoardTasks(tasks, 'column', null, now)).toEqual([]);
  });

  it('groups by person with unassigned last', () => {
    const groups = groupBoardTasks(tasks, 'person', project, now);
    expect(groups.map((group) => group.id)).toEqual(['ada', 'unassigned']);
    expect(groups[1].color).toBe('gray');
  });

  it('groups by priority in severity order', () => {
    expect(groupBoardTasks(tasks, 'priority', project, now).map((group) => group.title)).toEqual(['High', 'Low']);
  });

  it('groups by due window from most urgent', () => {
    expect(groupBoardTasks(tasks, 'dueWindow', project, now).map((group) => group.id)).toEqual(['overdue', 'none']);
  });

  it('repeats a multi-label card under each of its labels', () => {
    const groups = groupBoardTasks(tasks, 'label', project, now);
    expect(groups.map((group) => group.title)).toEqual(['cad', 'robot', 'No label']);
    expect(groups[0].tasks.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('classifies every due window', () => {
    expect(dueWindow(new Date('2026-03-10T20:00:00'), now).id).toBe('today');
    expect(dueWindow(new Date('2026-03-12T00:00:00'), now).id).toBe('soon');
    expect(dueWindow(new Date('2026-05-01T00:00:00'), now).id).toBe('later');
  });
});

describe('group summary', () => {
  it('builds status segments that add up to the group size', () => {
    const summary = summarizeGroup([
      task({ id: 'a', columnId: 'todo' }),
      task({ id: 'b', columnId: 'completed', status: 'completed' }),
      task({ id: 'c', columnId: 'completed', status: 'completed' })
    ], project);
    expect(summary.total).toBe(3);
    expect(summary.done).toBe(2);
    expect(summary.segments.map((segment) => segment.id)).toEqual(['todo', 'completed']);
    expect(Math.round(summary.segments.reduce((sum, segment) => sum + segment.percent, 0))).toBe(100);
  });

  it('collects cards sitting in a removed column under Other', () => {
    const summary = summarizeGroup([task({ id: 'a', columnId: 'archived-column' })], project);
    expect(summary.segments).toEqual([{ id: 'other', label: 'Other', color: 'gray', count: 1, percent: 100 }]);
  });

  it('handles an empty group and a missing project', () => {
    expect(summarizeGroup([], project)).toEqual({ segments: [], total: 0, done: 0 });
    expect(summarizeGroup([task({ status: 'completed' })], null).done).toBe(1);
  });
});

describe('board lookups', () => {
  it('resolves a column only when the project has it', () => {
    expect(boardColumn(project, 'todo')?.name).toBe('To Do');
    expect(boardColumn(project, 'missing')).toBeNull();
    expect(boardColumn(project, undefined)).toBeNull();
    expect(boardColumn(null, 'todo')).toBeNull();
  });

  it('lists the distinct people and labels on the board', () => {
    const tasks = [task({ assignedTo: 'zoe', labels: ['robot'] }), task({ assignedTo: 'ada', labels: ['robot', 'cad'] }), task()];
    expect(boardPeople(tasks)).toEqual(['ada', 'zoe']);
    expect(boardLabels(tasks)).toEqual(['cad', 'robot']);
  });
});
