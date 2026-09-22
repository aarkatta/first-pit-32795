import { DndContext } from '@dnd-kit/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardTable } from './BoardTable';
import { groupBoardTasks } from '@/lib/board-view';
import type { TeamMember } from '@/lib/directory';
import type { KanbanProject, TrackerTask } from '@/lib/domain';

const now = new Date('2026-03-10T09:00:00Z');

const directory = new Map<string, TeamMember>([
  ['ada', { userId: 'ada', role: 'student', status: 'active', displayName: 'Ada Lovelace', photoURL: null, initials: 'AL' }],
  ['zoe', { userId: 'zoe', role: 'coach', status: 'active', displayName: 'Zoe Chen', photoURL: null, initials: 'ZC' }]
]);

const project: KanbanProject = {
  id: 'project-1',
  teamId: 'team-1',
  createdBy: 'coach-1',
  name: 'Robot build',
  description: '',
  columns: [
    { id: 'todo', name: 'To Do', color: 'blue' },
    { id: 'completed', name: 'Completed', color: 'green' }
  ],
  categories: [{ id: 'build', name: 'Build', color: 'blue', areaId: null, goalId: null }],
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
    version: 3,
    ...overrides
  };
}

const tasks = [
  task({ id: 'task-1', title: 'Wire the arm', assignedTo: 'ada', dueAt: '2026-03-01T00:00:00Z' }),
  task({ id: 'task-2', title: 'Print the chassis', columnId: 'completed', status: 'completed', orderKey: 2048 })
];

function renderBoard(overrides: Partial<Parameters<typeof BoardTable>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onSelectGroup: vi.fn(),
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onMove: vi.fn(),
    onPatch: vi.fn(),
    onSubtaskStatus: vi.fn()
  };
  const props = {
    groups: groupBoardTasks(tasks, 'column', project, now),
    fields: ['person', 'status', 'priority', 'dueAt', 'timeline', 'labels', 'files'] as Parameters<typeof BoardTable>[0]['fields'],
    groupBy: 'column' as const,
    project,
    people: ['ada', 'zoe'],
    now,
    canManage: true,
    canMoveTask: () => true,
    disabled: false,
    selectedIds: new Set<string>(),
    focusGroupId: null,
    actorUserId: 'zoe',
    ...handlers,
    ...overrides
  };
  render(<DndContext><BoardTable {...props} /></DndContext>);
  return handlers;
}

describe('BoardTable subtasks', () => {
  const withSubtasks = task({
    id: 'parent-1',
    title: 'Build the team website',
    assignedTo: 'ada',
    subtasks: [
      { id: 'sub-1', title: 'Build UI', status: 'done', assignedTo: 'ada', dueAt: null },
      { id: 'sub-2', title: 'Create login screen', status: 'todo', assignedTo: 'zoe', dueAt: null }
    ]
  });

  it('shows subtask progress and reveals the sub-items only once expanded', () => {
    renderBoard({ groups: groupBoardTasks([withSubtasks], 'column', project, now) });
    const toggle = screen.getByRole('button', { name: /Show 2 subtasks of Build the team website/ });
    expect(toggle).toHaveTextContent('1/2');
    expect(screen.queryByText('Create login screen')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Build UI')).toBeInTheDocument();
    expect(screen.getByText('Create login screen')).toBeInTheDocument();
  });

  it('lets the card assignee change a sub-item status without opening the card', () => {
    const handlers = renderBoard({
      groups: groupBoardTasks([withSubtasks], 'column', project, now),
      canManage: false,
      actorUserId: 'ada'
    });
    fireEvent.click(screen.getByRole('button', { name: /Show 2 subtasks/ }));
    fireEvent.change(screen.getByLabelText('Status for subtask Create login screen'), { target: { value: 'inProgress' } });
    expect(handlers.onSubtaskStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'parent-1' }), 'sub-2', 'inProgress');
  });

  it('gives a teammate with no claim on the card or the sub-item no status control', () => {
    renderBoard({
      groups: groupBoardTasks([withSubtasks], 'column', project, now),
      canManage: false,
      actorUserId: 'someone-else'
    });
    fireEvent.click(screen.getByRole('button', { name: /Show 2 subtasks/ }));
    expect(screen.queryByLabelText('Status for subtask Build UI')).not.toBeInTheDocument();
  });

  it('gives a parent no status control, even on a card assigned to them before the rule', () => {
    renderBoard({
      groups: groupBoardTasks([withSubtasks], 'column', project, now),
      canManage: false,
      actorUserId: 'ada',
      mayWorkAsAssignee: false
    });
    fireEvent.click(screen.getByRole('button', { name: /Show 2 subtasks/ }));
    expect(screen.getByText('Build UI')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status for subtask Build UI')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status for subtask Create login screen')).not.toBeInTheDocument();
  });
});

describe('BoardTable groups', () => {
  it('renders one section per board column with its item count, including empty ones', () => {
    renderBoard({ groups: groupBoardTasks([tasks[0]], 'column', project, now) });
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
    expect(screen.getByText('0 items')).toBeInTheDocument();
  });

  it('collapses and expands a group', () => {
    renderBoard();
    const toggle = screen.getByRole('button', { name: 'Collapse To Do' });
    expect(screen.getByRole('button', { name: 'Wire the arm' })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Wire the arm' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand To Do' }));
    expect(screen.getByRole('button', { name: 'Wire the arm' })).toBeInTheDocument();
  });

  it('summarises each group in its footer', () => {
    renderBoard();
    expect(screen.getByText('1/1 done')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
  });

  it('reports an empty result set rather than rendering bare groups', () => {
    renderBoard({ groups: [] });
    expect(screen.getByText(/No items match the current filters/)).toBeInTheDocument();
  });
});

describe('BoardTable cells', () => {
  it('moves a card when the status cell changes', () => {
    const handlers = renderBoard();
    fireEvent.change(screen.getByLabelText('Status for Wire the arm'), { target: { value: 'completed' } });
    expect(handlers.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }), 'completed');
  });

  it('assigns a person from the roster and clears back to unassigned', () => {
    const handlers = renderBoard();
    const person = screen.getByLabelText('Person for Wire the arm');
    fireEvent.change(person, { target: { value: 'zoe' } });
    expect(handlers.onPatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }), { assignedTo: 'zoe' });
    fireEvent.change(person, { target: { value: '' } });
    expect(handlers.onPatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'task-1' }), { assignedTo: null });
  });

  it('sends a local date when the date cell changes, and null when it is cleared', () => {
    const handlers = renderBoard();
    const date = screen.getByLabelText('Due date for Wire the arm');
    fireEvent.change(date, { target: { value: '2026-04-02' } });
    const [, patch] = handlers.onPatch.mock.calls[0];
    expect(new Date(String(patch.dueAt)).getFullYear()).toBe(2026);
    fireEvent.change(date, { target: { value: '' } });
    expect(handlers.onPatch).toHaveBeenLastCalledWith(expect.anything(), { dueAt: null });
  });

  it('changes priority', () => {
    const handlers = renderBoard();
    fireEvent.change(screen.getByLabelText('Priority for Wire the arm'), { target: { value: 'urgent' } });
    expect(handlers.onPatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }), { priority: 'urgent' });
  });

  it('opens the task details from the title and the files chip', () => {
    const handlers = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Wire the arm' }));
    fireEvent.click(screen.getByRole('button', { name: '0 files on Wire the arm' }));
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('BoardTable permissions', () => {
  it('hides every editor from a member who cannot manage the board', () => {
    renderBoard({ canManage: false, canMoveTask: () => false });
    expect(screen.queryByLabelText('Person for Wire the arm')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status for Wire the arm')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Priority for Wire the arm')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Add an item/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wire the arm' })).toBeInTheDocument();
  });

  it('still lets a student change the status of a card assigned to them', () => {
    const handlers = renderBoard({ canManage: false, canMoveTask: (entry) => entry.id === 'task-1' });
    expect(screen.getByLabelText('Status for Wire the arm')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status for Print the chassis')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status for Wire the arm'), { target: { value: 'completed' } });
    expect(handlers.onMove).toHaveBeenCalled();
  });

  it('disables every control while the board is busy or offline', () => {
    renderBoard({ disabled: true });
    expect(screen.getByLabelText('Status for Wire the arm')).toBeDisabled();
    expect(screen.getByLabelText(/Add an item to To Do/)).toBeDisabled();
  });
});

describe('BoardTable selection and creation', () => {
  it('selects a single row and a whole group', () => {
    const handlers = renderBoard();
    fireEvent.click(screen.getByLabelText('Select Wire the arm'));
    expect(handlers.onSelect).toHaveBeenCalledWith('task-1', true);
    fireEvent.click(screen.getByLabelText('Select all items in To Do'));
    expect(handlers.onSelectGroup).toHaveBeenCalledWith(['task-1'], true);
  });

  it('adds an item into the group it was typed in', () => {
    const handlers = renderBoard();
    const input = screen.getByLabelText('Add an item to Completed');
    fireEvent.change(input, { target: { value: '  Sand the wheels  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(handlers.onCreate).toHaveBeenCalledWith('completed', 'Sand the wheels');
    expect(input).toHaveValue('');
  });

  it('ignores an empty add-item submission', () => {
    const handlers = renderBoard();
    const input = screen.getByLabelText('Add an item to To Do');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(handlers.onCreate).not.toHaveBeenCalled();
  });

  it('focuses the add-item box of the group the New item button targets', () => {
    renderBoard({ focusGroupId: 'completed' });
    expect(screen.getByLabelText('Add an item to Completed')).toHaveFocus();
  });

  it('drops the per-group add row when the board is grouped by something other than status', () => {
    renderBoard({ groupBy: 'person', groups: groupBoardTasks(tasks, 'person', project, now) });
    expect(screen.queryByLabelText(/Add an item/)).not.toBeInTheDocument();
    const unassigned = screen.getByRole('heading', { name: 'Unassigned' }).closest('section')!;
    expect(within(unassigned).getByRole('button', { name: 'Print the chassis' })).toBeInTheDocument();
  });
});

describe('BoardTable people directory', () => {
  it('lists teammates by name in the person cell instead of by user id', () => {
    renderBoard({ directory });
    const person = screen.getByLabelText('Person for Wire the arm');
    expect(within(person).getByRole('option', { name: 'Ada Lovelace' })).toHaveValue('ada');
    expect(within(person).getByRole('option', { name: 'Zoe Chen' })).toHaveValue('zoe');
    expect(within(person).getByRole('option', { name: 'Unassigned' })).toHaveValue('');
  });

  it('names the person group headings', () => {
    renderBoard({ directory, groupBy: 'person', groups: groupBoardTasks(tasks, 'person', project, now) });
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unassigned' })).toBeInTheDocument();
  });
});
