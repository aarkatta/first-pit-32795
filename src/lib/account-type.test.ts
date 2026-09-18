import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ onSnapshot: vi.fn(), doc: vi.fn(() => 'user-ref'), call: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, onSnapshot: mocks.onSnapshot }));
vi.mock('./firebase', () => ({ getFirebaseServices: () => ({ firestore: 'firestore' }) }));
vi.mock('./callable', () => ({ call: mocks.call }));

import { setAccountType, useAccountType } from './account-type';
import { canCreateTeams, isAccountType, mayOfferTeamCreation } from './domain';

describe('account type', () => {
  let push: (data: Record<string, unknown> | undefined) => void;
  let fail: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSnapshot.mockImplementation((_ref, next, error) => {
      push = (data) => next({ data: () => data });
      fail = () => error(new Error('denied'));
      return mocks.unsubscribe;
    });
  });

  it('saves the type through the server callable only', async () => {
    mocks.call.mockResolvedValue({ accountType: 'mentor', changed: true });
    await expect(setAccountType('mentor')).resolves.toEqual({ accountType: 'mentor', changed: true });
    expect(mocks.call).toHaveBeenCalledWith('setAccountType', { accountType: 'mentor' });
  });

  it('reads the type live from the private profile', () => {
    const { result, unmount } = renderHook(() => useAccountType('user-1'));
    expect(mocks.doc).toHaveBeenCalledWith('firestore', 'users', 'user-1');
    expect(result.current).toEqual({ status: 'loading', accountType: null });
    act(() => push({ accountType: 'coach' }));
    expect(result.current).toEqual({ status: 'ready', accountType: 'coach' });
    act(() => push({ accountType: 'captain' }));
    expect(result.current).toEqual({ status: 'ready', accountType: null });
    act(() => push(undefined));
    expect(result.current).toEqual({ status: 'ready', accountType: null });
    act(() => fail());
    expect(result.current).toEqual({ status: 'error', accountType: null });
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it('reports no type without reading when signed out', () => {
    const { result } = renderHook(() => useAccountType(null));
    expect(result.current).toEqual({ status: 'ready', accountType: null });
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });

  it('lets only coach and mentor accounts create teams', () => {
    expect(canCreateTeams('coach')).toBe(true);
    expect(canCreateTeams('mentor')).toBe(true);
    expect(canCreateTeams('student')).toBe(false);
    expect(canCreateTeams('parent')).toBe(false);
    expect(canCreateTeams(null)).toBe(false);
    expect(isAccountType('parent')).toBe(true);
    expect(isAccountType('teamLeader')).toBe(false);
  });

  it('never offers team creation to a student or parent on any team, whatever the account says', () => {
    expect(mayOfferTeamCreation('coach', [])).toBe(true);
    expect(mayOfferTeamCreation(null, [])).toBe(true);
    expect(mayOfferTeamCreation('student', [])).toBe(false);
    expect(mayOfferTeamCreation(null, [{ role: 'student', status: 'active' }])).toBe(false);
    expect(mayOfferTeamCreation('coach', [{ role: 'parent', status: 'pending' }])).toBe(false);
    expect(mayOfferTeamCreation('coach', [{ role: 'mentor', status: 'active' }, { role: 'student', status: 'removed' }])).toBe(true);
  });
});
