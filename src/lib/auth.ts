import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
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

export async function configureAuthPersistence(auth: Auth) {
  await setPersistence(auth, browserLocalPersistence);
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

/**
 * Google sign-in doubles as sign-up: Firebase creates the account on first use.
 * Google has already verified the address, so no verification email is sent.
 */
export function signInWithGoogle(auth: Auth): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  // Always let the user pick an account instead of silently reusing the last one.
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

/** A closed or superseded popup is a user gesture, not a failure worth reporting. */
export function isDismissedPopup(error: unknown): boolean {
  const code = error instanceof Error ? ((error as { code?: string }).code ?? error.message) : '';
  return code.includes('auth/popup-closed-by-user') || code.includes('auth/cancelled-popup-request');
}

export async function sendPasswordRecovery(auth: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export function signOutCurrentUser(auth: Auth): Promise<void> {
  return signOut(auth);
}
