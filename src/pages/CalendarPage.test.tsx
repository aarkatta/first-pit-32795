import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanProject, TeamGoal, TrackerTask } from '@/lib/domain';
import { CalendarPage } from './CalendarPage';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useTeamContext: vi.fn(),
  useTeamBoard: vi.fn(),
  useOnlineStatus: vi.fn(),
  subscribeProjectTasks: vi.fn(),
  loadTeamGoals: vi.fn(),
  // One object for every render, as the real services are: the page's effects depend on it.
  services: { firestore: {} }
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/use-team-board', () => ({ useTeamBoard: mocks.useTeamBoard }));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: mocks.useOnlineStatus }));
vi.mock('@/lib/firebase', () => ({ getFirebaseServices: () => mocks.services }));
vi.mock('@/lib/kanban-service', () => ({ subscribeProjectTasks: mocks.subscribeProjectTasks }));
vi.mock('@/lib/coordination-data', () => ({ loadTeamGoals: mocks.loadTeamGoals }));

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

function task(overrides: Partial<TrackerTask>): TrackerTask {
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
    ...overrides
  };
}

const milestone: TeamGoal = {
  id: 'goal-1',
  teamId: 'team-1',
  createdBy: 'coach-1',
  title: 'Scrimmage',
  description: '',
  status: 'active',
  dueAt: '2026-03-12T00:00:00',
  taskCount: 0,
  completedTaskCount: 0
};

/** Lets the milestone read resolve inside `act`, so no update lands after the test. */
async function renderPage() {
  const view = render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); });
  return view;
}

function setup(tasks: TrackerTask[], goals: TeamGoal[] = [milestone]) {
  mocks.useAuth.mockReturnValue({ user: { uid: 'student-1' } });
  mocks.useTeamContext.mockReturnValue({ status: 'ready', activeTeam: { teamId: 'team-1', role: 'student' } });
  mocks.useOnlineStatus.mockReturnValue(true);
  mocks.useTeamBoard.mockReturnValue({ project, status: 'ready', requestState: null, refresh: vi.fn() });
  mocks.loadTeamGoals.mockResolvedValue(goals);
  mocks.subscribeProjectTasks.mockImplementation((_firestore, _teamId, _project, onChange: (next: TrackerTask[]) => void) => {
    onChange(tasks);
    return () => undefined;
  });
  return renderPage();
}

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T09:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('asks for a team before loading anything', () => {
    mocks.useAuth.mockReturnValue({ user: null });
    mocks.useTeamContext.mockReturnValue({ status: 'ready', activeTeam: null });
    mocks.useOnlineStatus.mockReturnValue(true);
    mocks.useTeamBoard.mockReturnValue({ project: null, status: 'idle', requestState: null, refresh: vi.fn() });
    render(<MemoryRouter><CalendarPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Choose a team' })).toBeInTheDocument();
    expect(mocks.subscribeProjectTasks).not.toHaveBeenCalled();
  });

  it('shows the board error with a retry', async () => {
    const refresh = vi.fn();
    mocks.useAuth.mockReturnValue({ user: { uid: 'student-1' } });
    mocks.useTeamContext.mockReturnValue({ status: 'ready', activeTeam: { teamId: 'team-1', role: 'student' } });
    mocks.useOnlineStatus.mockReturnValue(true);
    mocks.loadTeamGoals.mockResolvedValue([]);
    mocks.useTeamBoard.mockReturnValue({ project: null, status: 'error', requestState: { variant: 'permission', title: 'Permission denied', message: 'No access.' }, refresh });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('puts tasks and milestones on their day and links them back to where they are edited', async () => {
    await setup([
      task({ id: 'a', title: 'Build the arm', dueAt: '2026-03-12T15:00:00', categoryId: 'build' }),
      task({ id: 'b', title: 'No date yet' })
    ]);
    expect(screen.getByRole('heading', { name: /March 2026/ })).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: /Days of March 2026/ });
    expect(within(grid).getByRole('link', { name: 'Task: Build the arm' })).toHaveAttribute('href', '/coordination?project=project-1&task=a');
    expect(within(grid).getByRole('link', { name: 'Milestone: Scrimmage' })).toHaveAttribute('href', '/milestones?goal=goal-1');
    expect(screen.getByText(/1 task has no date/)).toBeInTheDocument();
  });

  it('lists the selected day and collapses a crowded one', async () => {
    await setup(
      ['One', 'Two', 'Three', 'Four', 'Five'].map((title, index) => task({ id: `t${index}`, title, dueAt: '2026-03-12T15:00:00' })),
      []
    );
    expect(screen.getByText('Nothing due on this day.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
    const agenda = screen.getByRole('region', { name: /March 12/ });
    expect(within(agenda).getAllByRole('link')).toHaveLength(5);
  });

  it('narrows to the viewer and moves between months', async () => {
    await setup([
      task({ id: 'a', title: 'Mine', dueAt: '2026-03-12T15:00:00', assignedTo: 'student-1' }),
      task({ id: 'b', title: 'Theirs', dueAt: '2026-03-13T15:00:00', assignedTo: 'student-2' })
    ], []);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only my tasks' }));
    expect(screen.getByRole('link', { name: 'Task: Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Task: Theirs' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: /April 2026/ })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is dated in April 2026 for you/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: /March 2026/ })).toBeInTheDocument();
  });

  it('counts only the viewer\u2019s undated cards once narrowed to them', async () => {
    await setup([
      task({ id: 'a', title: 'Mine, no date', assignedTo: 'student-1' }),
      task({ id: 'b', title: 'Theirs, no date', assignedTo: 'student-2' }),
      task({ id: 'c', title: 'Also theirs', assignedTo: 'student-2' })
    ], []);
    expect(screen.getByText(/3 tasks have no date/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only my tasks' }));
    expect(screen.getByText(/1 task has no date/)).toBeInTheDocument();
  });

  it('does not claim the view is empty while a neighbouring month\u2019s card shows', async () => {
    // 1 April 2026 is a Wednesday, so April's grid opens with 29-31 March.
    await setup([task({ id: 'a', title: 'Last day of March', dueAt: '2026-03-31T15:00:00' })], []);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    const grid = screen.getByRole('list', { name: /Days of April 2026/ });
    expect(within(grid).getByRole('link', { name: 'Task: Last day of March' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is dated in April 2026/)).not.toBeInTheDocument();
  });
});
