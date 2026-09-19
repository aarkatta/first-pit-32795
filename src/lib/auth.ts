import {
  applyActionCode,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  checkActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  verifyPasswordResetCode,
  type ActionCodeSettings,
  type Auth,
  type User,
  type UserCredential
} from 'firebase/auth';
import { isNativeShell } from './native-shell';
import { publicWebOrigin } from './public-origin';

export { isNativeShell };

export class VerificationEmailDeliveryError extends Error {
  readonly user: User;

  constructor(user: User, cause: unknown) {
    super('The account was created, but the verification email could not be sent.', { cause });
    this.name = 'VerificationEmailDeliveryError';
    this.user = user;
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

/** The in-app route that handles `oobCode` links out of Firebase Auth emails. */
export const EMAIL_ACTION_PATH = '/auth/action';

/**
 * Where the verification link should drop the user.
 *
 * Without this, Firebase's own hosted handler ends the flow on a generic
 * "your email is verified" page with no way back, so the user has to find the
 * app tab again and prove it a second time. Pointing the continue URL at our
 * own handler closes the loop: whichever page applies the code, the user lands
 * back inside First Pit signed in and verified.
 *
 * The origin has to be in the Firebase Auth authorized-domain list, which a
 * per-branch preview deployment will not be — see `sendVerification`.
 */
export function emailActionCodeSettings(next?: string | null): ActionCodeSettings {
  const url = new URL(EMAIL_ACTION_PATH, publicWebOrigin());
  if (next) url.searchParams.set('next', next);
  return { url: url.toString(), handleCodeInApp: false };
}

/** A continue URL Firebase refuses to embed, as opposed to a real send failure. */
function isRejectedContinueUri(error: unknown): boolean {
  const code = authErrorCode(error);
  return code.includes('auth/unauthorized-continue-uri')
    || code.includes('auth/invalid-continue-uri')
    || code.includes('auth/missing-continue-uri');
}

/**
 * Sends the verification email, degrading rather than failing when this
 * origin is not an authorized domain: the link still verifies the address, it
 * just cannot offer a way back to this deployment.
 */
async function sendVerification(user: User, next?: string | null): Promise<void> {
  try {
    await sendEmailVerification(user, emailActionCodeSettings(next));
  } catch (error) {
    if (!isRejectedContinueUri(error)) throw error;
    await sendEmailVerification(user);
  }
}

export async function signUpWithEmail(auth: Auth, email: string, password: string): Promise<UserCredential> {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    await sendVerification(credential.user);
  } catch (error) {
    throw new VerificationEmailDeliveryError(credential.user, error);
  }
  return credential;
}

export function resendVerificationEmail(user: User, next?: string | null): Promise<void> {
  return sendVerification(user, next);
}

/**
 * Re-reads the account from the server and reports whether the address is now
 * verified.
 *
 * `reload()` mutates the `User` in place and writes it back to persistence,
 * but fires no auth state change, so callers have to act on the return value
 * rather than waiting for a re-render.
 *
 * `reload()` does NOT refresh the ID token, and Firestore rules and callables
 * read `email_verified` from the token. Without a forced refresh a newly
 * verified invitee keeps a `false` claim for up to an hour and cannot read
 * their own invitation.
 */
export async function refreshVerificationStatus(user: User): Promise<boolean> {
  await user.reload();
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
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
 * On the web it opens a popup, falling back to a redirect when the browser
 * blocks it; that path resolves to `null` because the page is navigating away
 * and the result arrives on the next load via `completeGoogleRedirect`.
 *
 * In the iOS shell neither can work: a popup has no opener at a `capacitor://`
 * origin and the redirect cannot return to the app. The native Google SDK
 * (`@capacitor-firebase/authentication`, `skipNativeAuth`) signs in instead
 * and hands its ID token to the JS SDK, which owns the session as on the web.
 */
export async function signInWithGoogle(auth: Auth): Promise<UserCredential | null> {
  if (isNativeShell()) return signInWithGoogleNative(auth);
  try {
    return await signInWithPopup(auth, googleProvider());
  } catch (error) {
    if (!isPopupUnavailable(error)) throw error;
    await signInWithRedirect(auth, googleProvider(), browserPopupRedirectResolver);
    return null;
  }
}

async function signInWithGoogleNative(auth: Auth): Promise<UserCredential> {
  // Loaded on demand so the web bundle never carries the plugin.
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error('Google sign-in did not return an ID token.');
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken, result.credential?.accessToken));
}

/**
 * Collects the result of a redirect sign-in. Returns `null` on a normal load
 * where no redirect was in flight, so callers can invoke it unconditionally.
 * The shell never redirects, and its Auth has no redirect resolver to ask.
 */
export function completeGoogleRedirect(auth: Auth): Promise<UserCredential | null> {
  if (isNativeShell()) return Promise.resolve(null);
  return getRedirectResult(auth);
}

/** A closed or superseded popup is a user gesture, not a failure worth reporting. */
export function isDismissedPopup(error: unknown): boolean {
  const code = authErrorCode(error);
  return code.includes('auth/popup-closed-by-user')
    || code.includes('auth/cancelled-popup-request')
    // The native Google sheet (iOS shell) reports a dismissal this way.
    || /user canceled the sign-in flow/i.test(code);
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

/**
 * The address Firebase Auth sends verification and recovery mail from.
 *
 * The default sender is `noreply@<authDomain>` — a domain the recipient has
 * never corresponded with and which carries no First Pit branding, so the mail
 * reliably lands in spam. Naming the sender lets someone search for it instead
 * of concluding nothing was sent; the real fix is a custom SMTP sender on a
 * domain the team owns.
 */
export function authEmailSender(auth: Auth | null): string | null {
  const domain = auth?.config?.authDomain;
  return domain ? `noreply@${domain}` : null;
}

export async function sendPasswordRecovery(auth: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutCurrentUser(auth: Auth): Promise<void> {
  await signOut(auth);
  // In the shell, also end the native Google session so the next Google
  // sign-in offers the account picker instead of silently reusing it.
  if (isNativeShell()) {
    try {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      await FirebaseAuthentication.signOut();
    } catch {
      // The web session is already gone, which is what signing out means.
    }
  }
}

/**
 * The email actions Firebase can send a user to a handler for.
 *
 * The action URL is one project-wide setting, so a handler that only knows
 * `verifyEmail` would break password recovery the moment the console is
 * pointed at it. All four are handled here for that reason.
 */
export type EmailActionMode = 'verifyEmail' | 'verifyAndChangeEmail' | 'recoverEmail' | 'resetPassword';

const EMAIL_ACTION_MODES: readonly EmailActionMode[] = [
  'verifyEmail',
  'verifyAndChangeEmail',
  'recoverEmail',
  'resetPassword'
];

export function parseEmailActionMode(mode: string | null): EmailActionMode | null {
  return EMAIL_ACTION_MODES.find((known) => known === mode) ?? null;
}

/** Reads the address an action code belongs to, without consuming the code. */
export async function inspectEmailActionCode(auth: Auth, oobCode: string): Promise<string | null> {
  const info = await checkActionCode(auth, oobCode);
  return info.data.email ?? null;
}

/** Consumes a `verifyEmail`, `verifyAndChangeEmail`, or `recoverEmail` code. */
export function applyEmailActionCode(auth: Auth, oobCode: string): Promise<void> {
  return applyActionCode(auth, oobCode);
}

/** Validates a `resetPassword` code and returns the address it is for. */
export function checkPasswordResetCode(auth: Auth, oobCode: string): Promise<string> {
  return verifyPasswordResetCode(auth, oobCode);
}

export function completePasswordReset(auth: Auth, oobCode: string, newPassword: string): Promise<void> {
  return confirmPasswordReset(auth, oobCode, newPassword);
}

/** A code that has already been used, expired, or was never valid. */
export function isSpentActionCode(error: unknown): boolean {
  const code = authErrorCode(error);
  return code.includes('auth/invalid-action-code')
    || code.includes('auth/expired-action-code')
    || code.includes('auth/user-disabled')
    || code.includes('auth/user-not-found');
}
