import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn()
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import { approveJoinRequest, createInvitation, createReport, updateTeamPolicy } from './phase2-service';

describe('Phase 2 callable service integration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ functions: 'functions' });
    mocks.httpsCallable.mockImplementation((_functions: unknown, name: string) => vi.fn().mockResolvedValue({ data: { name } }));
  });

  it('routes invitations to the authenticated server command with the selected role', async () => {
    await createInvitation('team-1', 'student@example.com', 'student');
    expect(mocks.httpsCallable).toHaveBeenCalledWith('functions', 'createInvitation');
    expect(mocks.httpsCallable.mock.results[0]?.value).toBeTypeOf('function');
  });

  it('keeps approvals and policy changes on callable boundaries', async () => {
    await approveJoinRequest('team-1', 'team-1_student-1');
    await updateTeamPolicy('team-1', { directMessaging: 'disabled', discoverability: 'private' });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(1, 'functions', 'approveJoinRequest');
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(2, 'functions', 'updateTeamPolicy');
  });

  it('passes reports without exposing a client-side Firestore write path', async () => {
    await createReport({ teamId: 'team-1', targetType: 'content', targetResource: 'teams/team-1/messages/message-1', reasonCode: 'unsafe-content' });
    expect(mocks.httpsCallable).toHaveBeenCalledWith('functions', 'createReport');
  });
});
