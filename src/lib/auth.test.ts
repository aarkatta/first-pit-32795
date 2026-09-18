import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setPersistence: vi.fn(),
  browserLocalPersistence: { name: 'local' },
  indexedDBLocalPersistence: { name: 'indexeddb' },
  browserPopupRedirectResolver: { name: 'resolver' },
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  applyActionCode: vi.fn(),
  checkActionCode: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signOut: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  signInWithCredential: vi.fn(),
  GoogleAuthProvider: Object.assign(vi.fn(function GoogleAuthProvider(this: Record<string, unknown>) {
    this.setCustomParameters = vi.fn();
  }), { credential: vi.fn((idToken: string, accessToken?: string) => ({ idToken, accessToken })) }),
  isNativePlatform: vi.fn(),
  nativeSignInWithGoogle: vi.fn(),
  nativeSignOut: vi.fn()
}));

vi.mock('firebase/auth', () => mocks);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }));
vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: { signInWithGoogle: mocks.nativeSignInWithGoogle, signOut: mocks.nativeSignOut }
}));

import {
  applyEmailActionCode,
  authEmailSender,
  checkPasswordResetCode,
  completeGoogleRedirect,
  completePasswordReset,
  emailActionCodeSettings,
  inspectEmailActionCode,
  isSpentActionCode,
  parseEmailActionMode,
  refreshVerificationStatus,
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
    expect(mocks.sendEmailVerification).toHaveBeenCalledWith(user, emailActionCodeSettings());
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

  it('signs in with the native Google SDK inside the Capacitor shell', async () => {
    // A popup has no opener at a capacitor:// origin and a redirect cannot
    // return to the app, so the shell hands the native ID token to the JS SDK.
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.nativeSignInWithGoogle.mockResolvedValue({ credential: { idToken: 'id-token', accessToken: 'access-token' } });
    mocks.signInWithCredential.mockResolvedValue({ user: { uid: 'native-user' } });

    await expect(signInWithGoogle(auth)).resolves.toEqual({ user: { uid: 'native-user' } });

    expect(mocks.nativeSignInWithGoogle).toHaveBeenCalledWith({ skipNativeAuth: true });
    expect(mocks.signInWithCredential).toHaveBeenCalledWith(auth, { idToken: 'id-token', accessToken: 'access-token' });
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('fails native Google sign-in that returns no ID token', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.nativeSignInWithGoogle.mockResolvedValue({ credential: null });

    await expect(signInWithGoogle(auth)).rejects.toThrow(/ID token/);
    expect(mocks.signInWithCredential).not.toHaveBeenCalled();
  });

  it('never asks for a redirect result inside the shell', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    await expect(completeGoogleRedirect(auth)).resolves.toBeNull();
    expect(mocks.getRedirectResult).not.toHaveBeenCalled();
  });

  it('also ends the native Google session on sign-out in the shell', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.signOut.mockResolvedValue(undefined);
    mocks.nativeSignOut.mockRejectedValue(new Error('no native session'));

    await expect(signOutCurrentUser(auth)).resolves.toBeUndefined();
    expect(mocks.signOut).toHaveBeenCalledWith(auth);
    expect(mocks.nativeSignOut).toHaveBeenCalledTimes(1);
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
    expect(isDismissedPopup(new Error('The user canceled the sign-in flow.'))).toBe(true);
    expect(isDismissedPopup(Object.assign(new Error('x'), { code: 'auth/popup-blocked' }))).toBe(false);
    expect(isDismissedPopup('not an error')).toBe(false);
  });

  describe('email action links', () => {
    it('points the verification link back at the in-app handler', () => {
      // Without a continue URL the flow ends on Firebase's own hosted page,
      // and the user has to find the app again and prove it a second time.
      const settings = emailActionCodeSettings('/join?invite=abc');
      expect(settings.url).toBe(`${window.location.origin}/auth/action?next=%2Fjoin%3Finvite%3Dabc`);
      expect(settings.handleCodeInApp).toBe(false);
    });

    it('points the continue URL at the public website from the iOS shell', () => {
      // capacitor://localhost is useless in an email and Firebase refuses it.
      mocks.isNativePlatform.mockReturnValue(true);
      vi.stubEnv('VITE_PUBLIC_WEB_ORIGIN', 'https://www.first-pit.com');
      try {
        expect(emailActionCodeSettings().url).toBe('https://www.first-pit.com/auth/action');
      } finally {
        vi.unstubAllEnvs();
        mocks.isNativePlatform.mockReturnValue(false);
      }
    });

    it('still sends the email when this origin is not an authorized domain', async () => {
      // A per-branch preview deployment is not in the Firebase authorized
      // domain list. Losing the return trip beats losing verification.
      const user = { uid: 'user' };
      mocks.sendEmailVerification
        .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/unauthorized-continue-uri' }))
        .mockResolvedValueOnce(undefined);

      await resendVerificationEmail(user as never);

      expect(mocks.sendEmailVerification).toHaveBeenNthCalledWith(2, user);
    });

    it('reports a real delivery failure rather than retrying forever', async () => {
      mocks.sendEmailVerification.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/too-many-requests' }));
      await expect(resendVerificationEmail({ uid: 'user' } as never)).rejects.toThrow();
      expect(mocks.sendEmailVerification).toHaveBeenCalledTimes(1);
    });

    it('re-reads the account so a stale verification flag does not gate the app', async () => {
      const user = { emailVerified: false, reload: vi.fn().mockImplementation(async () => { user.emailVerified = true; }), getIdToken: vi.fn().mockResolvedValue('token') };
      await expect(refreshVerificationStatus(user as never)).resolves.toBe(true);
      expect(user.reload).toHaveBeenCalled();
      // Rules read `email_verified` from the token, so a verified account needs a fresh one.
      expect(user.getIdToken).toHaveBeenCalledWith(true);
    });

    it('leaves the token alone while the address is still unverified', async () => {
      const user = { emailVerified: false, reload: vi.fn(), getIdToken: vi.fn() };
      await expect(refreshVerificationStatus(user as never)).resolves.toBe(false);
      expect(user.getIdToken).not.toHaveBeenCalled();
    });

    it('accepts only the modes the handler can complete', () => {
      expect(parseEmailActionMode('verifyEmail')).toBe('verifyEmail');
      expect(parseEmailActionMode('resetPassword')).toBe('resetPassword');
      expect(parseEmailActionMode('recoverEmail')).toBe('recoverEmail');
      expect(parseEmailActionMode('verifyAndChangeEmail')).toBe('verifyAndChangeEmail');
      expect(parseEmailActionMode('signIn')).toBeNull();
      expect(parseEmailActionMode(null)).toBeNull();
    });

    it('passes action codes through to the Firebase SDK', async () => {
      mocks.checkActionCode.mockResolvedValue({ data: { email: 'coach@example.com' } });
      mocks.verifyPasswordResetCode.mockResolvedValue('coach@example.com');

      await expect(inspectEmailActionCode(auth, 'code')).resolves.toBe('coach@example.com');
      await applyEmailActionCode(auth, 'code');
      await expect(checkPasswordResetCode(auth, 'reset')).resolves.toBe('coach@example.com');
      await completePasswordReset(auth, 'reset', 'newpassword');

      expect(mocks.applyActionCode).toHaveBeenCalledWith(auth, 'code');
      expect(mocks.confirmPasswordReset).toHaveBeenCalledWith(auth, 'reset', 'newpassword');
    });

    it('separates a spent code from a transient failure', () => {
      expect(isSpentActionCode(Object.assign(new Error('x'), { code: 'auth/expired-action-code' }))).toBe(true);
      expect(isSpentActionCode(Object.assign(new Error('x'), { code: 'auth/invalid-action-code' }))).toBe(true);
      // A network blip is worth retrying; telling the user the link is dead is not.
      expect(isSpentActionCode(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }))).toBe(false);
    });
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

describe('authEmailSender', () => {
  it('names the default Firebase sender for the project', () => {
    expect(authEmailSender({ config: { authDomain: 'first-pit-32795.firebaseapp.com' } } as never))
      .toBe('noreply@first-pit-32795.firebaseapp.com');
  });

  it('returns null rather than a broken address when there is no auth instance', () => {
    expect(authEmailSender(null)).toBeNull();
    expect(authEmailSender({} as never)).toBeNull();
  });
});
