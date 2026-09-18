import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFirebaseServices: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));

import { createTeam, normalizeTeamNumber, updateTeamDetails } from './team-service';

describe('team service', () => {
  it('rejects invalid names before making a privileged request', async () => {
    await expect(createTeam('x')).rejects.toThrow(/at least two/);
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
  });

  it('calls the server-side team bootstrap', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { teamId: 'team-1' } });
    mocks.getFirebaseServices.mockReturnValue({ functions: { name: 'functions' } });
    mocks.httpsCallable.mockReturnValue(callable);
    const result = await createTeam('  Robotics Team  ');
    expect(mocks.httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'createTeam');
    expect(callable).toHaveBeenCalledWith({ name: 'Robotics Team' });
    expect(result).toEqual({ teamId: 'team-1' });
  });

  it('sends a team number only when one is given, and validates it first', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { teamId: 'team-1' } });
    mocks.getFirebaseServices.mockReturnValue({ functions: {} });
    mocks.httpsCallable.mockReturnValue(callable);
    await createTeam('Robotics Team', ' 12345 ');
    expect(callable).toHaveBeenCalledWith({ name: 'Robotics Team', teamNumber: '12345' });
    await expect(createTeam('Robotics Team', '12ab')).rejects.toThrow(/1 to 8 digits/);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('renames the team and updates or clears its number in one call', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { teamId: 'team-1', name: 'Tech Summer', teamNumber: null } });
    mocks.getFirebaseServices.mockReturnValue({ functions: {} });
    mocks.httpsCallable.mockReturnValue(callable);
    await updateTeamDetails('team-1', { name: '  Tech   Summer ', teamNumber: '' });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, 'updateTeamDetails');
    expect(callable).toHaveBeenCalledWith({ teamId: 'team-1', name: 'Tech Summer', teamNumber: null });
    await expect(updateTeamDetails('team-1', { name: 'x', teamNumber: '1' })).rejects.toThrow(/at least two/);
    expect(callable).toHaveBeenCalledTimes(1);
    expect(normalizeTeamNumber('0042')).toBe('0042');
    expect(() => normalizeTeamNumber('123456789')).toThrow();
  });

  it('rejects an incomplete server response', async () => {
    mocks.getFirebaseServices.mockReturnValue({ functions: {} });
    mocks.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: {} }));
    await expect(createTeam('Robotics Team')).rejects.toThrow(/could not be created/);
  });
});
