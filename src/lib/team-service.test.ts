import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFirebaseServices: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));

import { createTeam } from './team-service';

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

  it('rejects an incomplete server response', async () => {
    mocks.getFirebaseServices.mockReturnValue({ functions: {} });
    mocks.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: {} }));
    await expect(createTeam('Robotics Team')).rejects.toThrow(/could not be created/);
  });
});
