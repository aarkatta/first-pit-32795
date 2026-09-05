import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setPersistence: vi.fn(),
  browserLocalPersistence: { name: 'local' },
  indexedDBLocalPersistence: { name: 'indexeddb' },
  browserPopupRedirectResolver: { name: 'resolver' },
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signOut: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider(this: Record<string, unknown>) {
    this.setCustomParameters = vi.fn();
  }),
  isNativePlatform: vi.fn()
}));

vi.mock('firebase/auth', () => mocks);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }));

import {
  completeGoogleRedirect,
  configureAuthPersistence,
  isDismissedPopup,
  isNativeShell,
  requiresEmailVerification,
  resendVerificationEmail,
  sendPasswordRecovery,
  signInWithEmail,
  signInWithGoogle,
  signOutCurrentUser,
  signUpWithEmail
} from './auth';

describe('auth service helpers', () => {
  const auth = { name: 'auth' } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.setPersistence.mockResolvedValue(undefined);
  });

  it('prefers IndexedDB persistence so an iOS WebView keeps the session', async () => {
    await configureAuthPersistence(auth);
    expect(mocks.setPersistence).toHaveBeenCalledWith(auth, mocks.indexedDBLocalPersistence);
  });

  it('falls back to local storage when IndexedDB is unavailable', async () => {
    // Safari private mode throws on IndexedDB. Falling back is what keeps
    // sign-in working there instead of failing before the listener attaches.
    mocks.setPersistence.mockRejectedValueOnce(new Error('IndexedDB unavailable')).mockResolvedValueOnce(undefined);
    await configureAuthPersistence(auth);
    expect(mocks.setPersistence).toHaveBeenNthCalledWith(1, auth, mocks.indexedDBLocalPersistence);
    expect(mocks.setPersistence).toHaveBeenNthCalledWith(2, auth, mocks.browserLocalPersistence);
  });

  it('normalizes email input for account operations', async () => {
    const user = { uid: 'new-user' };
    mocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
    await signUpWithEmail(auth, ' new@example.com ', 'password');
    await signInWithEmail(auth, ' user@example.com ', 'password');
    await sendPasswordRecovery(auth, ' reset@example.com ');
    await signOutCurrentUser(auth);
    expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalledWith(auth, 'new@example.com', 'password');
    expect(mocks.sendEmailVerification).toHaveBeenCalledWith(user);
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(auth, 'user@example.com', 'password');
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(auth, 'reset@example.com');
    expect(mocks.signOut).toHaveBeenCalledWith(auth);
  });

  it('preserves the created user when verification delivery fails so retry is recoverable', async () => {
    const user = { uid: 'created-user' };
    mocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
    mocks.sendEmailVerification.mockRejectedValueOnce(new Error('mail unavailable')).mockResolvedValueOnce(undefined);

    await expect(signUpWithEmail(auth, 'new@example.com', 'password')).rejects.toMatchObject({
      name: 'VerificationEmailDeliveryError',
      user
    });
    await resendVerificationEmail(user as never);

    expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailVerification).toHaveBeenCalledTimes(2);
  });

  it('opens a Google popup on the web that forces account selection', async () => {
    const user = { uid: 'google-user' };
    mocks.signInWithPopup.mockResolvedValue({ user });

    await expect(signInWithGoogle(auth)).resolves.toEqual({ user });

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
    const provider = mocks.signInWithPopup.mock.calls[0][1];
    expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(mocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('redirects instead of popping up inside the Capacitor shell', async () => {
    // A popup has no opener to post back to at a capacitor:// origin, so the
    // popup path cannot work on iOS at all.
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.signInWithRedirect.mockResolvedValue(undefined);

    await expect(signInWithGoogle(auth)).resolves.toBeNull();

    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect.mock.calls[0][2]).toBe(mocks.browserPopupRedirectResolver);
  });

  it('falls back to a redirect when the browser blocks the popup', async () => {
    mocks.signInWithPopup.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));
    mocks.signInWithRedirect.mockResolvedValue(undefined);

    await expect(signInWithGoogle(auth)).resolves.toBeNull();
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('rethrows a genuine popup failure rather than silently redirecting', async () => {
    const failure = Object.assign(new Error('nope'), { code: 'auth/internal-error' });
    mocks.signInWithPopup.mockRejectedValue(failure);

    await expect(signInWithGoogle(auth)).rejects.toBe(failure);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('collects a redirect result and reports no redirect as null', async () => {
    mocks.getRedirectResult.mockResolvedValue(null);
    await expect(completeGoogleRedirect(auth)).resolves.toBeNull();
    expect(mocks.getRedirectResult).toHaveBeenCalledWith(auth);
  });

  it('reports a non-native environment when Capacitor throws', () => {
    mocks.isNativePlatform.mockImplementation(() => {
      throw new Error('not available');
    });
    // The web shim must never be the reason sign-in fails.
    expect(isNativeShell()).toBe(false);
  });

  it('treats a closed or superseded popup as a dismissal rather than a failure', () => {
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }))).toBe(true);
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/cancelled-popup-request' }))).toBe(true);
    expect(isDismissedPopup(new Error('auth/popup-closed-by-user'))).toBe(true);
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/popup-blocked' }))).toBe(false);
    expect(isDismissedPopup('not an error')).toBe(false);
  });

  describe('requiresEmailVerification', () => {
    const password = { providerId: 'password' };
    const google = { providerId: 'google.com' };

    it('requires verification only for an unverified password account', () => {
      expect(requiresEmailVerification({ emailVerified: false, providerData: [password] } as never)).toBe(true);
      expect(requiresEmailVerification({ emailVerified: true, providerData: [password] } as never)).toBe(false);
      // Google already proved the address, so there is nothing to verify.
      expect(requiresEmailVerification({ emailVerified: false, providerData: [google] } as never)).toBe(false);
      expect(requiresEmailVerification({ emailVerified: false, providerData: [] } as never)).toBe(false);
      expect(requiresEmailVerification(null)).toBe(false);
    });

    it('still requires verification when a password provider is linked alongside Google', () => {
      expect(requiresEmailVerification({ emailVerified: false, providerData: [google, password] } as never)).toBe(true);
    });
  });
});
