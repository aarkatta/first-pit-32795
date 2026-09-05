import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  configureAuthPersistence: vi.fn().mockResolvedValue(undefined),
  signOutCurrentUser: vi.fn().mockResolvedValue(undefined),
  bootstrapUserProfile: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('firebase/auth', () => ({ onAuthStateChanged: mocks.onAuthStateChanged }));
vi.mock('./auth', () => ({
  configureAuthPersistence: mocks.configureAuthPersistence,
  signOutCurrentUser: mocks.signOutCurrentUser
}));
vi.mock('./profile', () => ({ bootstrapUserProfile: mocks.bootstrapUserProfile }));

import { AuthProvider, useAuth } from './auth-context';

function Probe() {
  const { status, user, error, signOut } = useAuth();
  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="user">{user?.uid ?? 'none'}</output>
      <output data-testid="error">{error?.message ?? 'none'}</output>
      <button type="button" onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('restores a user session and delegates sign out', async () => {
    let nextUser: ((user: unknown) => void) | undefined;
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      nextUser = callback;
      return () => undefined;
    });
    const auth = { currentUser: null } as never;
    render(<AuthProvider auth={auth}><Probe /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    act(() => nextUser?.({ uid: 'user-1' }));
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('user')).toHaveTextContent('user-1');
    screen.getByRole('button', { name: 'Sign out' }).click();
    expect(mocks.signOutCurrentUser).toHaveBeenCalledWith(auth);
  });

  it('surfaces auth listener errors', async () => {
    let onError: ((error: Error) => void) | undefined;
    mocks.onAuthStateChanged.mockImplementation((_auth, _callback, errorCallback) => {
      onError = errorCallback;
      return () => undefined;
    });
    render(<AuthProvider auth={{ currentUser: null } as never}><Probe /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });
    act(() => onError?.(new Error('session unavailable')));
    expect(screen.getByTestId('status')).toHaveTextContent('error');
    expect(screen.getByTestId('error')).toHaveTextContent('session unavailable');
  });
});
