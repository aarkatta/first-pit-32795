import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  doc: vi.fn(() => 'profile-ref'),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  runTransaction: vi.fn(),
  getFirebaseServices: vi.fn()
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  serverTimestamp: mocks.serverTimestamp,
  runTransaction: mocks.runTransaction
}));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import { bootstrapUserProfile } from './profile';

describe('profile bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseServices.mockReturnValue({ firestore: 'firestore' });
    mocks.runTransaction.mockImplementation(async (_firestore, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => false }),
      set: vi.fn(),
      update: vi.fn()
    }));
  });

  it('creates a private profile for a newly authenticated user', async () => {
    const user = { uid: 'user-1', email: 'coach@example.com', displayName: null, photoURL: null } as never;
    await bootstrapUserProfile(user);

    expect(mocks.doc).toHaveBeenCalledWith('firestore', 'users', 'user-1');
    expect(mocks.runTransaction).toHaveBeenCalledWith('firestore', expect.any(Function));
  });

  it('preserves user-customized fields when a retry finds the profile', async () => {
    const update = vi.fn();
    mocks.runTransaction.mockImplementation(async (_firestore, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ email: 'coach@example.com', displayName: 'Saved coach name', photoURL: 'https://example.com/saved.png' }) }),
      set: vi.fn(),
      update
    }));
    await bootstrapUserProfile({ uid: 'user-1', email: 'coach@example.com', displayName: 'Stale Auth name', photoURL: null } as never);
    expect(update).not.toHaveBeenCalled();
  });

  it('fills only missing defaults on an existing profile', async () => {
    const update = vi.fn();
    mocks.runTransaction.mockImplementation(async (_firestore, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ uid: 'user-1' }) }),
      set: vi.fn(),
      update
    }));
    await bootstrapUserProfile({ uid: 'user-1', email: 'coach@example.com', displayName: 'Coach', photoURL: 'https://example.com/auth.png' } as never);
    expect(update).toHaveBeenCalledWith('profile-ref', expect.objectContaining({ email: 'coach@example.com', displayName: 'Coach', photoURL: 'https://example.com/auth.png' }));
  });
});
