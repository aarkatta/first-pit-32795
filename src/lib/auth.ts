import { Capacitor } from '@capacitor/core';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
  type UserCredential
} from 'firebase/auth';

export class VerificationEmailDeliveryError extends Error {
  readonly user: User;

  constructor(user: User, cause: unknown) {
    super('The account was created, but the verification email could not be sent.', { cause });
    this.name = 'VerificationEmailDeliveryError';
    this.user = user;
  }
}

/**
 * True inside the Capacitor iOS shell.
 *
 * The shell runs the same bundle from a `capacitor://` origin, where a popup
 * has no opener to post back to, so the sign-in flow has to differ. Wrapped in
 * a try/catch because `Capacitor` is a web shim in a plain browser and must
 * never be the reason sign-in fails.
 */
export function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * IndexedDB first, falling back to localStorage.
 *
 * `browserLocalPersistence` alone loses the session in a WKWebView whose local
 * storage the OS may evict, and in Safari private mode it throws outright.
 * Firebase's own guidance is this ordered pair, so a session survives an app
 * restart on iOS rather than silently signing the user out.
 */
export async function configureAuthPersistence(auth: Auth) {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch {
    await setPersistence(auth, browserLocalPersistence);
  }
}

export async function signUpWithEmail(auth: Auth, email: string, password: string): Promise<UserCredential> {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    await sendEmailVerification(credential.user);
  } catch (error) {
    throw new VerificationEmailDeliveryError(credential.user, error);
  }
  return credential;
}

export function resendVerificationEmail(user: User): Promise<void> {
  return sendEmailVerification(user);
}

export async function signInWithEmail(auth: Auth, email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

/** A popup that cannot open at all, as opposed to one the user dismissed. */
function isPopupUnavailable(error: unknown): boolean {
  const code = authErrorCode(error);
  return code.includes('auth/popup-blocked')
    || code.includes('auth/operation-not-supported-in-this-environment')
    || code.includes('auth/web-storage-unsupported');
}

function authErrorCode(error: unknown): string {
  return error instanceof Error ? ((error as { code?: string }).code ?? error.message) : '';
}

function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Always let the user pick an account instead of silently reusing the last one.
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

/**
 * Google sign-in doubles as sign-up: Firebase creates the account on first use.
 * Google has already verified the address, so no verification email is sent.
 *
 * Resolves to `null` when a redirect has been started — the page is navigating
 * away and the result arrives on the next load via `completeGoogleRedirect`.
 * The redirect path covers the Capacitor shell, where popups cannot work, and
 * a desktop browser that blocks the popup outright.
 */
export async function signInWithGoogle(auth: Auth): Promise<UserCredential | null> {
  if (isNativeShell()) {
    await signInWithRedirect(auth, googleProvider(), browserPopupRedirectResolver);
    return null;
  }
  try {
    return await signInWithPopup(auth, googleProvider());
  } catch (error) {
    if (!isPopupUnavailable(error)) throw error;
    await signInWithRedirect(auth, googleProvider(), browserPopupRedirectResolver);
    return null;
  }
}

/**
 * Collects the result of a redirect sign-in. Returns `null` on a normal load
 * where no redirect was in flight, so callers can invoke it unconditionally.
 */
export function completeGoogleRedirect(auth: Auth): Promise<UserCredential | null> {
  return getRedirectResult(auth);
}

/** A closed or superseded popup is a user gesture, not a failure worth reporting. */
export function isDismissedPopup(error: unknown): boolean {
  const code = authErrorCode(error);
  return code.includes('auth/popup-closed-by-user') || code.includes('auth/cancelled-popup-request');
}

/**
 * Whether this account still has to prove it owns its email address.
 *
 * Only password accounts can: a federated provider such as Google has already
 * verified the address, and an account with no password provider has no
 * verification step to complete.
 */
export function requiresEmailVerification(user: User | null): boolean {
  if (!user || user.emailVerified) return false;
  return user.providerData.some((provider) => provider.providerId === 'password');
}

export async function sendPasswordRecovery(auth: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export function signOutCurrentUser(auth: Auth): Promise<void> {
  return signOut(auth);
}
