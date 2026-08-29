import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), updateDoc: vi.fn(), setDoc: vi.fn(), doc: vi.fn((...parts: string[]) => parts.slice(-2).join('/')) }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, getDoc: mocks.getDoc, updateDoc: mocks.updateDoc, setDoc: mocks.setDoc, serverTimestamp: vi.fn(() => 'server-time') }));

import { loadProfileSettings } from './profile-settings';

describe('profile settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDoc.mockImplementation(async (reference: string) => ({ data: () => reference.endsWith('users/u1') ? { displayName: 'Coach', photoURL: null } : {} }));
  });

  it('loads privacy-safe defaults when optional settings are absent', async () => {
    const result = await loadProfileSettings('firestore' as never, 'u1');
    expect(result.profile.displayName).toBe('Coach');
    expect(result.privacy.searchable).toBe(false);
    expect(result.notifications.safetyNotifications).toBe(true);
    expect(result.preferences.theme).toBe('system');
  });
});
