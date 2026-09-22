import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn(() => ({ functions: 'functions' }))
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import { getDashboard, requestAccountDeletion, updateProfileSettings } from './phase7-service';

describe('Phase 7 client service contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockImplementation((_functions, name) => async (input: unknown) => ({ data: { name, input } }));
  });

  it('preserves every callable name, payload, empty input, and returned data', async () => {
    const profile = { displayName: 'Student', photoURL: null, theme: 'system' as const, highContrast: true, reducedMotion: false, fontScale: 'large' as const, emailNotifications: true, pushNotifications: false };
    const cases: Array<[string, () => Promise<unknown>, unknown]> = [
      ['getDashboard', () => getDashboard('team-1'), { teamId: 'team-1' }],
      ['requestAccountDeletion', () => requestAccountDeletion(), {}],
      ['updateProfileSettings', () => updateProfileSettings(profile), profile]
    ];

    for (const [name, invoke, input] of cases) {
      await expect(invoke()).resolves.toEqual({ name, input });
      expect(mocks.httpsCallable).toHaveBeenLastCalledWith('functions', name);
    }
  });

  it('propagates callable errors unchanged and without retry', async () => {
    const failure = new Error('network unavailable');
    mocks.httpsCallable.mockReturnValueOnce(vi.fn().mockRejectedValue(failure));
    await expect(getDashboard('team-1')).rejects.toBe(failure);
    expect(mocks.httpsCallable).toHaveBeenCalledOnce();
  });
});
