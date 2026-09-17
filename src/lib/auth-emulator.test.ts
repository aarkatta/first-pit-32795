import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ parseClientEnv: vi.fn() }));

vi.mock('./env', () => ({ parseClientEnv: mocks.parseClientEnv }));

import { latestVerificationLink, usingAuthEmulator } from './auth-emulator';

const emulatorEnv = {
  useFirebaseEmulators: true,
  firebase: { projectId: 'first-pit-demo' },
  emulatorHosts: { auth: { host: '127.0.0.1', port: 9099 } }
};

function respondWith(oobCodes: unknown[]) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ oobCodes }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseClientEnv.mockReturnValue(emulatorEnv);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth emulator verification links', () => {
  it('builds an in-app link from the newest code for that address', async () => {
    const fetchMock = respondWith([
      { requestType: 'VERIFY_EMAIL', email: 'other@example.com', oobCode: 'wrong-user' },
      { requestType: 'PASSWORD_RESET', email: 'coach@example.com', oobCode: 'wrong-type' },
      { requestType: 'VERIFY_EMAIL', email: 'Coach@Example.com', oobCode: 'older' },
      { requestType: 'VERIFY_EMAIL', email: 'coach@example.com', oobCode: 'newest' }
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const link = await latestVerificationLink('coach@example.com');

    expect(link).toBe(`${window.location.origin}/auth/action?mode=verifyEmail&oobCode=newest`);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9099/emulator/v1/projects/first-pit-demo/oobCodes');
  });

  it('returns nothing when no verification code was issued', async () => {
    vi.stubGlobal('fetch', respondWith([]));
    await expect(latestVerificationLink('coach@example.com')).resolves.toBeNull();
  });

  it('never reaches for emulator codes against a real project', async () => {
    const fetchMock = respondWith([]);
    vi.stubGlobal('fetch', fetchMock);
    mocks.parseClientEnv.mockReturnValue({ ...emulatorEnv, useFirebaseEmulators: false });

    expect(usingAuthEmulator()).toBe(false);
    await expect(latestVerificationLink('coach@example.com')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports no emulator when the environment cannot even be parsed', () => {
    mocks.parseClientEnv.mockImplementation(() => {
      throw new Error('Invalid First Pit client environment');
    });
    expect(usingAuthEmulator()).toBe(false);
  });
});
