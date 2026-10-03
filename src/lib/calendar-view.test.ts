import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calendarEntries,
  dayKey,
  filterEntriesForMember,
  groupEntriesByDay,
  monthGrid,
  monthLabel,
  startOfMonth,
  taskCalendarDate,
  undatedTaskCount,
  weekdayLabels
} from './calendar-view';
import type { KanbanProject, TeamGoal, TrackerTask } from './domain';

const now = new Date('2026-03-10T09:00:00');

const project: KanbanProject = {
  id: 'project-1',
  teamId: 'team-1',
  createdBy: 'coach-1',
  name: 'Season board',
  description: '',
  columns: [{ id: 'todo', name: 'To Do', color: 'blue' }],
  categories: [{ id: 'build', name: 'Build', color: 'orange', areaId: null, goalId: null }],
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
    categoryId: null,
    labels: [],
    checklist: [],
    subtasks: [],
    attachmentFileIds: [],
    historyCount: 0,
    columnId: 'todo',
    orderKey: 1024,
    ...overrides
  };
}

function goal(overrides: Partial<TeamGoal> = {}): TeamGoal {
  return {
    id: 'goal-1',
    teamId: 'team-1',
    createdBy: 'coach-1',
    title: 'Robot ready',
    description: '',
    status: 'active',
    taskCount: 0,
    completedTaskCount: 0,
    ...overrides
  };
}

describe('month maths', () => {
  it('keys a day in local time', () => {
    expect(dayKey(new Date('2026-03-05T23:30:00'))).toBe('2026-03-05');
    expect(dayKey(new Date('2026-11-21T00:00:00'))).toBe('2026-11-21');
  });

  it('steps between months across a year boundary', () => {
    expect(dayKey(startOfMonth(now))).toBe('2026-03-01');
    expect(dayKey(addMonths(new Date('2026-12-15T12:00:00'), 1))).toBe('2027-01-01');
    expect(dayKey(addMonths(new Date('2026-01-31T12:00:00'), -1))).toBe('2025-12-01');
  });

  it('labels the month and a Sunday-first week', () => {
    expect(monthLabel(now)).toMatch(/2026/);
    const labels = weekdayLabels();
    expect(labels).toHaveLength(7);
    expect(new Set(labels).size).toBe(7);
  });

  it('pads the grid to whole weeks and marks today', () => {
    // March 2026 starts on a Sunday and ends on a Tuesday: five full rows.
    const march = monthGrid(now, now);
    expect(march).toHaveLength(35);
    expect(march[0]).toMatchObject({ key: '2026-03-01', inMonth: true, isToday: false });
    expect(march[34]).toMatchObject({ key: '2026-04-04', inMonth: false });
    expect(march.filter((day) => day.isToday).map((day) => day.key)).toEqual(['2026-03-10']);

    // August 2026 starts on a Saturday, so it needs a sixth row.
    const august = monthGrid(new Date('2026-08-01T12:00:00'), now);
    expect(august).toHaveLength(42);
    expect(august[0]).toMatchObject({ key: '2026-07-26', inMonth: false });
    expect(august.some((day) => day.isToday)).toBe(false);
  });
});

describe('taskCalendarDate', () => {
  it('prefers the deadline, then the planned end, then the start', () => {
    const all = task({ dueAt: '2026-03-12T10:00:00', endAt: '2026-03-11T10:00:00', startAt: '2026-03-09T10:00:00' });
    expect(dayKey(taskCalendarDate(all)!)).toBe('2026-03-12');
    expect(dayKey(taskCalendarDate(task({ endAt: '2026-03-11T10:00:00', startAt: '2026-03-09T10:00:00' }))!)).toBe('2026-03-11');
    expect(dayKey(taskCalendarDate(task({ startAt: '2026-03-09T10:00:00' }))!)).toBe('2026-03-09');
    expect(taskCalendarDate(task())).toBeNull();
  });
});

describe('calendarEntries', () => {
  it('places dated tasks and milestones and skips undated or archived ones', () => {
    const tasks = [
      task({ id: 'a', title: 'Build the arm', dueAt: '2026-03-12T15:00:00', categoryId: 'build', assignedTo: 'student-1' }),
      task({ id: 'b', title: 'Done already', dueAt: '2026-03-12T08:00:00', status: 'completed' }),
      task({ id: 'c', title: 'No date' })
    ];
    const goals = [
      goal({ id: 'g1', dueAt: '2026-03-12T00:00:00' }),
      goal({ id: 'g2', title: 'Achieved', dueAt: '2026-03-20T00:00:00', status: 'completed' }),
      goal({ id: 'g3', dueAt: '2026-03-21T00:00:00', status: 'archived' }),
      goal({ id: 'g4' })
    ];
    const entries = calendarEntries(tasks, goals, project);
    expect(entries.map((entry) => entry.key)).toEqual(['task-a', 'task-b', 'milestone-g1', 'milestone-g2']);
    expect(entries[0]).toMatchObject({ kind: 'task', color: 'orange', done: false, assignedTo: 'student-1', href: '/coordination?project=project-1&task=a' });
    expect(entries[0].day.getHours()).toBe(0);
    expect(entries[1]).toMatchObject({ color: 'gray', done: true });
    expect(entries[2]).toMatchObject({ kind: 'milestone', href: '/milestones?goal=g1', done: false });
    expect(entries[3].done).toBe(true);
    expect(undatedTaskCount(tasks)).toBe(1);
  });

  it('links a card without naming a board when none is loaded', () => {
    const [entry] = calendarEntries([task({ id: 'a', dueAt: '2026-03-12T15:00:00', categoryId: 'build' })], [], null);
    expect(entry).toMatchObject({ href: '/coordination?task=a', color: 'gray' });
  });
});

describe('grouping and filtering', () => {
  const entries = calendarEntries(
    [
      task({ id: 'a', title: 'Zip ties', dueAt: '2026-03-12T15:00:00', assignedTo: 'student-1' }),
      task({ id: 'b', title: 'Attachment', dueAt: '2026-03-12T08:00:00', assignedTo: 'student-2' }),
      task({ id: 'c', title: 'Poster', dueAt: '2026-03-14T08:00:00' })
    ],
    [goal({ id: 'g1', title: 'Scrimmage', dueAt: '2026-03-12T00:00:00' })],
    project
  );

  it('groups by day with milestones first, then by title', () => {
    const byDay = groupEntriesByDay(entries);
    expect([...byDay.keys()].sort()).toEqual(['2026-03-12', '2026-03-14']);
    expect(byDay.get('2026-03-12')?.map((entry) => entry.title)).toEqual(['Scrimmage', 'Attachment', 'Zip ties']);
  });

  it('keeps milestones when narrowing to one member', () => {
    expect(filterEntriesForMember(entries, 'student-1').map((entry) => entry.key)).toEqual(['task-a', 'milestone-g1']);
    expect(filterEntriesForMember(entries, 'nobody').map((entry) => entry.key)).toEqual(['milestone-g1']);
  });
});
