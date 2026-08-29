import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setPersistence: vi.fn(),
  browserLocalPersistence: { name: 'local' },
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signOut: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider(this: Record<string, unknown>) {
    this.setCustomParameters = vi.fn();
  })
}));

vi.mock('firebase/auth', () => mocks);

import { configureAuthPersistence, isDismissedPopup, resendVerificationEmail, sendPasswordRecovery, signInWithEmail, signInWithGoogle, signOutCurrentUser, signUpWithEmail } from './auth';

describe('auth service helpers', () => {
  const auth = { name: 'auth' } as never;

  beforeEach(() => vi.clearAllMocks());

  it('configures local session persistence', async () => {
    await configureAuthPersistence(auth);
    expect(mocks.setPersistence).toHaveBeenCalledWith(auth, mocks.browserLocalPersistence);
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

  it('opens a Google popup that forces account selection and never sends a verification email', async () => {
    const user = { uid: 'google-user' };
    mocks.signInWithPopup.mockResolvedValue({ user });

    await expect(signInWithGoogle(auth)).resolves.toEqual({ user });

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    const provider = mocks.signInWithPopup.mock.calls[0][1];
    expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(mocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('treats a closed or superseded popup as a dismissal rather than a failure', () => {
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }))).toBe(true);
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/cancelled-popup-request' }))).toBe(true);
    expect(isDismissedPopup(new Error('auth/popup-closed-by-user'))).toBe(true);
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/popup-blocked' }))).toBe(false);
    expect(isDismissedPopup('not an error')).toBe(false);
  });
});
