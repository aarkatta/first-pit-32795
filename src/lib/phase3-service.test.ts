import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ kind: 'collection', name })),
  doc: vi.fn((_db: unknown, name: string, id: string) => ({ kind: 'doc', name, id })),
  getDoc: vi.fn(),
  where: vi.fn((...args: unknown[]) => ({ kind: 'where', args })),
  orderBy: vi.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  startAfter: vi.fn((value: unknown) => ({ kind: 'startAfter', value })),
  query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
  getDocs: vi.fn(),
  ref: vi.fn((_storage: unknown, path: string) => ({ kind: 'ref', path })),
  uploadBytesResumable: vi.fn(),
  getDownloadURL: vi.fn()
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('firebase/firestore', () => ({ collection: mocks.collection, doc: mocks.doc, getDoc: mocks.getDoc, where: mocks.where, orderBy: mocks.orderBy, limit: mocks.limit, startAfter: mocks.startAfter, query: mocks.query, getDocs: mocks.getDocs }));
vi.mock('firebase/storage', () => ({ ref: mocks.ref, uploadBytesResumable: mocks.uploadBytesResumable, getDownloadURL: mocks.getDownloadURL }));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import {
  UploadAbortedError,
  buildTeamFilesQuery,
  createTask,
  formatFileSize,
  listActiveTeamGoals,
  listTeamFiles,
  parseTeamGoal,
  updateGoal,
  uploadTeamFile
} from './phase3-service';

type UploadHandlers = {
  next: (snapshot: { bytesTransferred: number; totalBytes: number }) => void;
  error: (error: Error) => void;
  complete: () => void;
};

function fakeUpload() {
  const handlers: Partial<UploadHandlers> = {};
  const cancel = vi.fn();
  mocks.uploadBytesResumable.mockReturnValue({
    cancel,
    on: (_event: string, next: UploadHandlers['next'], error: UploadHandlers['error'], complete: UploadHandlers['complete']) => {
      handlers.next = next;
      handlers.error = error;
      handlers.complete = complete;
    }
  });
  return { handlers: handlers as UploadHandlers, cancel };
}

const file = { name: 'plan.pdf', type: 'application/pdf', size: 12 } as unknown as File;

describe('Phase 3 service boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions', storage: 'storage' });
    mocks.httpsCallable.mockImplementation((_functions: unknown, name: string) => vi.fn().mockResolvedValue({ data: { name, storagePath: 'teams/team-1/files/file-1/plan.pdf' } }));
    mocks.getDownloadURL.mockResolvedValue('https://files.example/plan.pdf');
  });

  it('routes task mutations through callable authorization', async () => {
    await createTask({ teamId: 'team-1', operationId: 'operation-1', title: 'Test robot' });
    expect(mocks.httpsCallable).toHaveBeenCalledWith('functions', 'createTask');
  });

  it('sends an idempotency receipt and a version check with every goal edit', async () => {
    const send = vi.fn().mockResolvedValue({ data: { goalId: 'goal-1', version: 2 } });
    mocks.httpsCallable.mockReturnValue(send);
    await updateGoal({ teamId: 'team-1', goalId: 'goal-1', operationId: 'operation-9', expectedVersion: 1, title: 'Tournament prep' });
    expect(mocks.httpsCallable).toHaveBeenCalledWith('functions', 'updateGoal');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'operation-9', expectedVersion: 1 }));
  });
});

describe('team goals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions', storage: 'storage' });
  });

  it('reads a goal with its version, so an edit can send the version it saw', () => {
    const goal = parseTeamGoal('goal-1', { teamId: 'team-1', title: 'Tournament readiness', status: 'completed', taskCount: 5, completedTaskCount: 3, version: 4 });
    expect(goal).toMatchObject({ id: 'goal-1', title: 'Tournament readiness', status: 'completed', taskCount: 5, completedTaskCount: 3, version: 4 });
  });

  it('defaults a goal written before versions existed, and refuses an unknown status', () => {
    const goal = parseTeamGoal('goal-2', { teamId: 'team-1', status: 'nonsense', taskCount: -3 });
    expect(goal).toMatchObject({ title: 'Untitled goal', status: 'active', version: 1, taskCount: 0 });
  });

  it("asks only for this team's active goals, bounded, for the card picker", async () => {
    mocks.getDocs.mockResolvedValue({ docs: [{ id: 'goal-1', data: () => ({ teamId: 'team-1', title: 'Tournament readiness' }) }] });
    const goals = await listActiveTeamGoals('db' as never, 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('teamId', '==', 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'active');
    expect(mocks.limit).toHaveBeenCalledWith(50);
    expect(goals.map((goal) => goal.id)).toEqual(['goal-1']);
  });
});

describe('Storage Area reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions', storage: 'storage' });
    mocks.getDownloadURL.mockResolvedValue('https://files.example/plan.pdf');
  });

  it('scopes the file query to the team and to the documents the read rule clears', () => {
    buildTeamFilesQuery('db' as never, 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('teamId', '==', 'team-1');
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'ready');
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(20);
    expect(mocks.startAfter).not.toHaveBeenCalled();
  });

  it('resolves a download link per file and fails that link soft', async () => {
    mocks.getDownloadURL.mockRejectedValueOnce(new Error('object missing'));
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'file-1', data: () => ({ teamId: 'team-1', name: 'plan.pdf', sizeBytes: 2048, storagePath: 'teams/team-1/files/file-1/plan.pdf', uploadedBy: 'coach-1', status: 'ready' }) },
        { id: 'file-2', data: () => ({ teamId: 'team-1', name: 'notes.txt', sizeBytes: 10, storagePath: 'teams/team-1/files/file-2/notes.txt', uploadedBy: 'coach-1', status: 'ready' }) }
      ]
    });
    const page = await listTeamFiles('db' as never, 'team-1');
    expect(page.files.map((entry) => entry.downloadUrl)).toEqual([null, 'https://files.example/plan.pdf']);
    expect(page.cursor).toBeNull();
  });

  it('formats sizes for humans', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('uploadTeamFile lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions', storage: 'storage' });
    mocks.httpsCallable.mockImplementation((_functions: unknown, name: string) => vi.fn().mockResolvedValue({ data: { name, storagePath: 'teams/team-1/files/file-1/plan.pdf' } }));
  });

  it('cancels the transfer and stops progress once the caller aborts', async () => {
    const { handlers, cancel } = fakeUpload();
    const controller = new AbortController();
    const onProgress = vi.fn();
    const pending = uploadTeamFile({ teamId: 'team-1', fileId: 'file-1', file, signal: controller.signal, onProgress });
    await vi.waitFor(() => expect(handlers.next).toBeTypeOf('function'));

    handlers.next({ bytesTransferred: 6, totalBytes: 12 });
    expect(onProgress).toHaveBeenCalledWith(0.5);

    controller.abort();
    expect(cancel).toHaveBeenCalled();
    handlers.next({ bytesTransferred: 12, totalBytes: 12 });
    handlers.error(new Error('storage/canceled'));

    await expect(pending).rejects.toBeInstanceOf(UploadAbortedError);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('refuses to finalize against a team the user has switched away from', async () => {
    const { handlers } = fakeUpload();
    let activeTeamId = 'team-1';
    const pending = uploadTeamFile({ teamId: 'team-1', fileId: 'file-1', file, activeTeamId: () => activeTeamId });
    await vi.waitFor(() => expect(handlers.complete).toBeTypeOf('function'));

    activeTeamId = 'team-2';
    handlers.complete();

    await expect(pending).rejects.toBeInstanceOf(UploadAbortedError);
    expect(mocks.httpsCallable).not.toHaveBeenCalledWith('functions', 'completeFileUpload');
  });

  it('finalizes when the same team is still active', async () => {
    const { handlers } = fakeUpload();
    const pending = uploadTeamFile({ teamId: 'team-1', fileId: 'file-1', file, activeTeamId: () => 'team-1' });
    await vi.waitFor(() => expect(handlers.complete).toBeTypeOf('function'));
    handlers.complete();
    await expect(pending).resolves.toBeDefined();
    expect(mocks.httpsCallable).toHaveBeenCalledWith('functions', 'completeFileUpload');
  });
});
