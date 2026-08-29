import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collection: vi.fn(() => 'collection'),
  documentId: vi.fn(() => 'documentId'),
  getDocs: vi.fn(),
  limit: vi.fn(() => 'limit'),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(() => 'orderBy'),
  query: vi.fn(() => 'query'),
  where: vi.fn(() => 'where')
}));

vi.mock('firebase/firestore', () => mocks);

import { buildUserMembershipQuery, MAX_USER_TEAMS, subscribeToUserTeams } from './teams';

describe('team data access', () => {
  it('builds a bounded query for only the signed-in user active memberships', () => {
    buildUserMembershipQuery({} as never, 'coach-1');
    expect(mocks.where).toHaveBeenCalledWith('userId', '==', 'coach-1');
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'active');
    expect(mocks.limit).toHaveBeenCalledWith(MAX_USER_TEAMS + 1);
  });

  it('rejects an invalid user ID before creating a Firestore query', () => {
    expect(() => subscribeToUserTeams({} as never, '', vi.fn(), vi.fn())).toThrow(/User ID/);
  });

  it('loads bounded active memberships and their team records', async () => {
    let nextSnapshot: ((snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => Promise<void>) | undefined;
    mocks.onSnapshot.mockImplementation((_query, callback) => {
      nextSnapshot = callback;
      return () => undefined;
    });
    mocks.getDocs.mockResolvedValue({
      docs: [{ id: 'team-1', data: () => ({ name: 'Robotics', normalizedName: 'robotics', createdBy: 'coach-1' }) }]
    });
    const onChange = vi.fn();
    const onError = vi.fn();
    subscribeToUserTeams({} as never, 'coach-1', onChange, onError);
    await nextSnapshot?.({
      docs: [{ id: 'team-1_coach-1', data: () => ({ teamId: 'team-1', userId: 'coach-1', role: 'coach', status: 'active' }) }]
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ teamId: 'team-1', team: expect.objectContaining({ name: 'Robotics' }) })
    ]);
  });

  it('reports Firestore snapshot failures', () => {
    let onErrorCallback: ((error: Error) => void) | undefined;
    mocks.onSnapshot.mockImplementation((_query, _callback, errorCallback) => {
      onErrorCallback = errorCallback;
      return () => undefined;
    });
    const onError = vi.fn();
    subscribeToUserTeams({} as never, 'user-1', vi.fn(), onError);
    onErrorCallback?.(new Error('permission denied'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'permission denied' }));
  });
});
