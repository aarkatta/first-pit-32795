import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  limit: vi.fn((value: number) => ({ type: 'limit', value })),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  getDocs: vi.fn(),
  onSnapshot: vi.fn()
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  where: mocks.where,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  query: mocks.query,
  getDocs: mocks.getDocs,
  onSnapshot: mocks.onSnapshot
}));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import {
  MAX_MIGRATION_PAGES,
  buildProjectsQuery,
  buildProjectColumnQuery,
  createProject,
  ensureDefaultProject,
  isVersionConflict,
  moveTaskCard,
  parseKanbanProject,
  projectVersion,
  removeProjectColumn,
  reorderProjectColumns,
  updateProjectColumn,
  parseKanbanTask,
  subscribeProjectTasks
} from './kanban-service';

describe('Kanban client boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions' });
    mocks.httpsCallable.mockImplementation((_functions: unknown, name: string) => vi.fn().mockResolvedValue({ data: { name } }));
  });

  it('routes project creation and card moves through callable authorization', async () => {
    await createProject({ teamId: 'team-1', operationId: 'op-1', name: 'Robot' });
    await moveTaskCard({ teamId: 'team-1', projectId: 'project-1', taskId: 'task-1', columnId: 'review', expectedVersion: 2, operationId: 'op-2' });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(1, 'functions', 'createProject');
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(2, 'functions', 'moveTaskCard');
  });

  it('builds a team/project/column scoped 50-card query', () => {
    buildProjectColumnQuery('db' as never, 'team-1', 'project-1', 'todo');
    expect(mocks.where).toHaveBeenCalledWith('teamId', '==', 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('projectId', '==', 'project-1');
    expect(mocks.where).toHaveBeenCalledWith('columnId', '==', 'todo');
    expect(mocks.orderBy).toHaveBeenCalledWith('orderKey', 'asc');
    expect(mocks.limit).toHaveBeenCalledWith(50);
  });

  it('bounds the active-project query to one team and ten boards', () => {
    buildProjectsQuery('db' as never, 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('teamId', '==', 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('archived', '==', false);
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
    expect(mocks.limit).toHaveBeenCalledWith(10);
  });

  it('sends the version every column mutation was based on', async () => {
    const send = vi.fn().mockResolvedValue({ data: { projectId: 'project-1', version: 4 } });
    mocks.httpsCallable.mockReturnValue(send);
    await updateProjectColumn({ teamId: 'team-1', projectId: 'project-1', columnId: 'todo', expectedVersion: 3, name: 'Backlog' });
    await reorderProjectColumns('team-1', 'project-1', ['todo', 'done'], 3);
    await removeProjectColumn('team-1', 'project-1', 'todo', 3);
    for (const [input] of send.mock.calls) expect(input).toMatchObject({ expectedVersion: 3 });
  });

  it('normalises a project written before versions existed to version 1', () => {
    expect(projectVersion(parseKanbanProject('project-1', { teamId: 'team-1', name: 'Robot' }))).toBe(1);
    expect(projectVersion(parseKanbanProject('project-1', { teamId: 'team-1', name: 'Robot', version: 7 }))).toBe(7);
    expect(projectVersion(parseKanbanProject('project-1', { teamId: 'team-1', name: 'Robot', version: 'nope' }))).toBe(1);
  });

  it('recognises a losing version race as a conflict, not a generic failure', () => {
    expect(isVersionConflict({ code: 'functions/aborted' })).toBe(true);
    expect(isVersionConflict({ code: 'aborted' })).toBe(true);
    expect(isVersionConflict({ code: 'permission-denied' })).toBe(false);
    expect(isVersionConflict(new Error('nope'))).toBe(false);
  });

  it('parses migration-compatible projects and cards', () => {
    const project = parseKanbanProject('project-1', { teamId: 'team-1', createdBy: 'coach', name: 'Robot', columns: [{ id: 'todo', name: 'Backlog', color: 'blue' }], completedColumnId: 'todo' });
    const task = parseKanbanTask('task-1', { teamId: 'team-1', createdBy: 'coach', title: 'Drive test', projectId: 'project-1', columnId: 'todo', orderKey: 1024, version: 3 });
    expect(project.columns[0]).toMatchObject({ id: 'todo', name: 'Backlog' });
    expect(task).toMatchObject({ projectId: 'project-1', columnId: 'todo', orderKey: 1024, version: 3 });
  });

  it('falls back safely when a card contains invalid enum or numeric data', () => {
    const task = parseKanbanTask('task-1', { status: 'hidden', priority: 'critical', orderKey: 'not-a-number', version: 0 });
    expect(task).toMatchObject({ status: 'todo', priority: 'medium', orderKey: 0, version: 1 });
  });

  it('waits for every column initial snapshot regardless of listener order', () => {
    const callbacks: Array<(snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void> = [];
    const cleanups = [vi.fn(), vi.fn()];
    mocks.onSnapshot.mockImplementation((_query, next) => {
      callbacks.push(next);
      return cleanups[callbacks.length - 1];
    });
    const onChange = vi.fn();
    const project = parseKanbanProject('project-1', {
      teamId: 'team-1',
      name: 'Robot',
      columns: [{ id: 'todo', name: 'Todo' }, { id: 'review', name: 'Review' }]
    });
    const cleanup = subscribeProjectTasks('db' as never, 'team-1', project, onChange, vi.fn());

    callbacks[1]({ docs: [{ id: 'review-1', data: () => ({ teamId: 'team-1', projectId: 'project-1', columnId: 'review', title: 'Review' }) }] });
    expect(onChange).not.toHaveBeenCalled();
    callbacks[0]({ docs: [{ id: 'todo-1', data: () => ({ teamId: 'team-1', projectId: 'project-1', columnId: 'todo', title: 'Todo' }) }] });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'todo-1' }), expect.objectContaining({ id: 'review-1' })]);

    cleanup();
    expect(cleanups[0]).toHaveBeenCalled();
    expect(cleanups[1]).toHaveBeenCalled();
  });

  it('emits the columns that loaded when one column listener fails, and reports one error', () => {
    const nexts: Array<(snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void> = [];
    const errors: Array<(error: Error) => void> = [];
    mocks.onSnapshot.mockImplementation((_query, next, onError) => {
      nexts.push(next);
      errors.push(onError);
      return vi.fn();
    });
    const onChange = vi.fn();
    const onError = vi.fn();
    const project = parseKanbanProject('project-1', {
      teamId: 'team-1',
      name: 'Robot',
      columns: [{ id: 'todo', name: 'Todo' }, { id: 'review', name: 'Review' }]
    });
    subscribeProjectTasks('db' as never, 'team-1', project, onChange, onError);

    nexts[0]({ docs: [{ id: 'todo-1', data: () => ({ teamId: 'team-1', projectId: 'project-1', columnId: 'todo', title: 'Todo' }) }] });
    expect(onChange).not.toHaveBeenCalled();

    errors[1](new Error('permission-denied'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'todo-1' })]);
    expect(onError).toHaveBeenCalledTimes(1);

    errors[0](new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('Kanban tracker migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions' });
  });

  it('walks every migration page and reports progress', async () => {
    const pages = [
      { projectId: 'project-1', created: true, migratedTaskCount: 2, nextCursor: 'cursor-1' },
      { projectId: 'project-1', created: false, migratedTaskCount: 3, nextCursor: null }
    ];
    let call = 0;
    mocks.httpsCallable.mockReturnValue(vi.fn().mockImplementation(() => Promise.resolve({ data: pages[call++] })));
    const onProgress = vi.fn();
    const result = await ensureDefaultProject('team-1', { onProgress });
    expect(result).toMatchObject({ projectId: 'project-1', created: true, migratedTaskCount: 5, complete: true, pages: 2 });
    expect(onProgress).toHaveBeenCalledWith({ page: 1, migratedTaskCount: 2 });
  });

  it('caps the walk instead of following an endless cursor', async () => {
    const send = vi.fn().mockResolvedValue({ data: { projectId: 'project-1', created: false, migratedTaskCount: 1, nextCursor: 'never-ends' } });
    mocks.httpsCallable.mockReturnValue(send);
    const result = await ensureDefaultProject('team-1');
    expect(send).toHaveBeenCalledTimes(MAX_MIGRATION_PAGES);
    expect(result.complete).toBe(false);
  });

  it('stops calling against the old team once the caller aborts', async () => {
    const controller = new AbortController();
    const send = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ data: { projectId: 'project-1', created: false, migratedTaskCount: 1, nextCursor: 'cursor-1' } });
    });
    mocks.httpsCallable.mockReturnValue(send);
    const result = await ensureDefaultProject('team-1', { signal: controller.signal });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.complete).toBe(false);
  });
});
