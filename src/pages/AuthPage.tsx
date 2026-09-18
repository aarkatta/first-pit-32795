import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { authEmailSender, completeGoogleRedirect, isDismissedPopup, resendVerificationEmail, sendPasswordRecovery, signInWithEmail, signInWithGoogle, signUpWithEmail, VerificationEmailDeliveryError } from '@/lib/auth';
import { bootstrapUserProfile } from '@/lib/profile';
import { setAccountType } from '@/lib/account-type';
import { ACCOUNT_TYPE_OPTIONS, type AccountType } from '@/lib/domain';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

type AuthMode = 'signIn' | 'signUp' | 'recover';

function authErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'That request could not be completed. Try again.';
  // Firebase puts the code on `error.code`; older paths only carry it in the message.
  const code = `${(error as { code?: string }).code ?? ''} ${error.message}`;
  if (code.includes('auth/invalid-credential')) return 'The email or password is not correct.';
  if (code.includes('auth/email-already-in-use')) return 'An account already exists for that email.';
  if (code.includes('auth/weak-password')) return 'Use a password with at least six characters.';
  if (code.includes('auth/invalid-email')) return 'Enter a valid email address.';
  if (code.includes('auth/account-exists-with-different-credential')) {
    return 'An account already exists for that email. Sign in with your password, then link Google from your profile.';
  }
  if (code.includes('auth/popup-blocked')) return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
  // Naming the host matters: the fix is to add exactly this origin to the
  // Firebase Auth authorized-domain list, and a preview deployment gets a
  // different one on every branch.
  if (code.includes('auth/unauthorized-domain')) {
    return `Sign-in is not enabled for this site address (${window.location.hostname}). Ask an administrator to authorize this domain in Firebase Authentication.`;
  }
  // Both mean the provider was never switched on in the Firebase console.
  if (code.includes('auth/operation-not-allowed') || code.includes('auth/configuration-not-found')) {
    return 'That sign-in method is not enabled for this project yet.';
  }
  if (code.includes('auth/network-request-failed')) return 'The authentication service could not be reached. Check your connection.';
  if (code.includes('auth/too-many-requests')) return 'Too many attempts. Wait a moment before trying again.';
  return 'That request could not be completed. Try again.';
}

function recoveryNotice(sender: string | null): string {
  const sent = 'If an account exists for that address, a recovery email has been sent.';
  const where = sender ? ` Check your spam or junk folder and search for ${sender}.` : ' Check your spam or junk folder.';
  return `${sent}${where} If you created your account with Google, sign in with Google instead — that account has no password to reset.`;
}

/** ` (permission-denied)`, or nothing when the error carries no Firebase code. */
function failureCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? ` (${code})` : '';
}

export function AuthPage() {
  const { auth, user, status, error: authError, retry } = useAuth();
  const online = useOnlineStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountTypeChoice] = useState<AccountType | ''>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [pendingProfileUser, setPendingProfileUser] = useState<User | null>(null);
  const [pendingVerificationUser, setPendingVerificationUser] = useState<User | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);

  // A redirect sign-in finishes on the next page load, not in the click
  // handler that started it. AuthProvider creates the profile from its own
  // session listener, so this only has to route the user and surface failures.
  useEffect(() => {
    if (!auth) return undefined;
    let active = true;
    completeGoogleRedirect(auth)
      .then((credential) => {
        if (!active || !credential) return;
        navigate(new URLSearchParams(location.search).get('next') || '/team', { replace: true });
      })
      .catch((redirectError: unknown) => {
        if (!active || isDismissedPopup(redirectError)) return;
        setRequestState({ variant: 'error', title: 'Google sign-in failed', message: authErrorMessage(redirectError) });
      });
    return () => {
      active = false;
    };
  }, [auth, location.search, navigate]);

  if (status === 'authenticated' && !pendingProfileUser && !pendingVerificationUser && !busy) {
    const needsVerification = user?.providerData.some((provider) => provider.providerId === 'password') && !user.emailVerified;
    return (
      <section className="card auth-card">
        <p className="eyebrow">Signed in</p>
        <h1>{needsVerification ? 'Verify your email address.' : 'Your First Pit session is ready.'}</h1>
        <p>{needsVerification ? `Open the verification link in your inbox before accepting an email invitation. If it is not there, check your spam or junk folder${authEmailSender(auth) ? ` and search for ${authEmailSender(auth)}` : ''}.` : 'Open your team hub to continue.'}</p>
        {verificationNotice ? <p role="status">{verificationNotice}</p> : null}
        {needsVerification && user ? (
          <button className="button secondary" type="button" onClick={() => void resendForSignedInUser(user)}>Resend verification email</button>
        ) : null}
        <Link className="button" to="/team">Open your team</Link>
      </section>
    );
  }

  async function resendForSignedInUser(currentUser: User) {
    setBusy(true);
    setVerificationNotice(null);
    try {
      await resendVerificationEmail(currentUser, destination());
      setVerificationNotice('A new verification email has been sent.');
    } catch {
      setVerificationNotice('The verification email could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function bootstrapPendingProfile(user: User): Promise<boolean> {
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return false;
    }

    try {
      await bootstrapUserProfile(user);
      // Best effort: a type that fails to save here is asked for again on the
      // Create team page, the one place it matters.
      if (mode === 'signUp' && accountType) await setAccountType(accountType).catch(() => undefined);
      setPendingProfileUser(null);
      return true;
    } catch (profileError) {
      const nextState = getRequestState(profileError, online);
      // A denied profile write is never a team-access problem — the account was
      // created seconds ago and belongs to no team yet — so the shared
      // "check your team access or ask a coach" copy sends the user after a
      // permission that does not exist. Name the real failure instead, and
      // carry the Firebase code so it can be reported.
      if (nextState.variant === 'permission') {
        setRequestState({
          variant: 'error',
          title: 'Profile setup failed',
          message: `You are signed in, but First Pit could not save your private profile${failureCode(profileError)}. Try again, and report this to an administrator if it keeps happening.`
        });
        return false;
      }
      setRequestState(nextState.variant === 'error'
        ? { ...nextState, title: 'Profile setup failed', message: 'Your account is signed in, but the private profile could not be saved. Try again.' }
        : nextState);
      return false;
    }
  }

  function destination() {
    return new URLSearchParams(location.search).get('next') || '/team';
  }

  /** Google sign-in covers both modes: Firebase creates the account on first use. */
  async function submitGoogle() {
    if (!auth) {
      setRequestState({ variant: 'error', title: 'Authentication unavailable', message: 'Authentication is not available in this environment.' });
      return;
    }
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    setMessage(null);
    try {
      const credential = await signInWithGoogle(auth);
      // Null means a redirect started: this page is navigating away and the
      // result is collected by the effect above on the next load.
      if (!credential) return;
      setPendingProfileUser(credential.user);
      if (await bootstrapPendingProfile(credential.user)) navigate(destination(), { replace: true });
    } catch (requestError) {
      if (isDismissedPopup(requestError)) return;
      const nextState = getRequestState(requestError, online);
      setRequestState(nextState.variant === 'error'
        ? { ...nextState, title: 'Google sign-in failed', message: authErrorMessage(requestError) }
        : nextState);
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!auth) {
      setRequestState({ variant: 'error', title: 'Authentication unavailable', message: 'Authentication is not available in this environment.' });
      return;
    }
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    setMessage(null);
    try {
      if (mode === 'signIn') {
        await signInWithEmail(auth, email, password);
        navigate(destination(), { replace: true });
      } else if (mode === 'signUp') {
        const credential = await signUpWithEmail(auth, email, password);
        setPendingProfileUser(credential.user);
        if (await bootstrapPendingProfile(credential.user)) navigate('/team', { replace: true });
      } else {
        await sendPasswordRecovery(auth, email);
        // Testers reported the recovery mail as never sent; it was in their spam
        // folder every time, because Firebase's default sender is a noreply@
        // address on a domain they had never corresponded with. Two accounts
        // also had no password to recover — Google sign-in creates no password
        // credential — and enumeration protection makes both cases look alike.
        setMessage(recoveryNotice(authEmailSender(auth)));
      }
    } catch (requestError) {
      if (requestError instanceof VerificationEmailDeliveryError) {
        setPendingVerificationUser(requestError.user);
        setRequestState({
          variant: 'error',
          title: 'Verification email not sent',
          message: 'Your account was created, but the verification email could not be sent. Retry without creating another account.'
        });
        return;
      }
      const nextState = getRequestState(requestError, online);
      setRequestState(nextState.variant === 'error'
        ? { ...nextState, title: 'Authentication failed', message: authErrorMessage(requestError) }
        : nextState);
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingProfileUser || pendingVerificationUser) {
      retryAuthentication();
      return;
    }
    void submitRequest();
  }

  function retryAuthentication() {
    if (pendingVerificationUser) {
      const currentUser = pendingVerificationUser;
      setBusy(true);
      setRequestState(null);
      void resendVerificationEmail(currentUser, destination())
        .then(async () => {
          setPendingVerificationUser(null);
          setPendingProfileUser(currentUser);
          if (await bootstrapPendingProfile(currentUser)) navigate('/team', { replace: true });
        })
        .catch(() => {
          setRequestState({
            variant: 'error',
            title: 'Verification email not sent',
            message: 'The verification email still could not be sent. Check your connection and try again.'
          });
        })
        .finally(() => setBusy(false));
      return;
    }
    if (pendingProfileUser) {
      setRequestState(null);
      void bootstrapPendingProfile(pendingProfileUser).then((ready) => {
        if (ready) navigate('/team', { replace: true });
      });
      return;
    }
    setRequestState(null);
    retry();
  }

  const title = pendingVerificationUser
    ? 'Send your verification email'
    : pendingProfileUser ? 'Finish setting up your account'
    : mode === 'signIn' ? 'Sign in to First Pit' : mode === 'signUp' ? 'Create your account' : 'Recover your account';

  return (
    <main className="onboarding-shell">
      <div className="onboarding-art">
        <h2>One private workspace for your FLL team</h2>
        <p>Plan practice, track the innovation project, talk to the team, and reach the official scoresheet in one click.</p>
        <ul className="art-points">
          <li>Boards and tasks everyone can see</li>
          <li>Files and team notifications</li>
          <li>Moderated questions and trusted FLL resources</li>
          <li>One-click access to the official FIRST scoresheet</li>
        </ul>
      </div>
      <section className="onboarding-panel">
        <Link className="brand" to="/"><span className="brand-mark">FP</span><span>FIRST PIT</span></Link>
        <form className="onboarding-content" onSubmit={handleSubmit} aria-labelledby="auth-title">
          <Link className="back-link" to="/">← Back</Link>
          <span className="eyebrow">{mode === 'signIn' ? 'PERSONAL ACCOUNT' : mode === 'signUp' ? 'CREATE ACCOUNT' : 'ACCOUNT RECOVERY'}</span>
          <h1 id="auth-title">{title}</h1>
          <p>{mode === 'signIn' ? 'Welcome back to your profile and authorized team workspaces.' : mode === 'signUp' ? 'Create a private identity before joining or creating a team.' : 'We will send a recovery link if an account exists for this address.'}</p>
        {status === 'loading' ? <StatePanel variant="loading" title="Checking your session" message="First Pit is checking your secure session." /> : null}
        {status === 'error' && authError ? (
          <StatePanel
            {...getRequestState(authError, online)}
            actionLabel="Try again"
            onAction={retryAuthentication}
            autoFocus
          />
        ) : null}
        {!online && !requestState ? (
          <StatePanel variant="offline" title="You are offline" message="Reconnect before signing in or creating an account." actionLabel="Try again" onAction={retryAuthentication} />
        ) : null}
        {requestState ? <StatePanel {...requestState} actionLabel="Try again" onAction={retryAuthentication} autoFocus /> : null}
        {message ? <StatePanel variant="success" title="Check your inbox" message={message} /> : null}
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        {mode === 'signUp' && !pendingProfileUser && !pendingVerificationUser ? (
          <label>I am a
            <select value={accountType} onChange={(event) => setAccountTypeChoice(event.target.value as AccountType | '')} required>
              <option value="">Choose…</option>
              {ACCOUNT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <small>Coaches and mentors can create a team; students and parents join by invitation. You choose this once.</small>
          </label>
        ) : null}
        {mode !== 'recover' ? <label>Password<input type="password" autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></label> : null}
        <button className="submit-button" type="submit" disabled={busy} aria-label={busy ? 'Working' : pendingVerificationUser ? 'Retry verification email' : pendingProfileUser ? 'Retry profile setup' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send recovery email'}>{busy ? 'Working…' : pendingVerificationUser ? 'Retry verification email' : pendingProfileUser ? 'Retry profile setup' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send recovery email'} <span aria-hidden="true">→</span></button>
        {mode !== 'recover' && !pendingProfileUser && !pendingVerificationUser ? (
          <>
            <div className="auth-divider"><span>or</span></div>
            <button className="google-button" type="button" onClick={() => void submitGoogle()} disabled={busy}>
              <svg className="google-mark" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              {mode === 'signUp' ? 'Sign up with Google' : 'Continue with Google'}
            </button>
          </>
        ) : null}
        <div className="auth-links">
          {mode === 'signIn' ? (
            <>
              <button className="text-button" type="button" onClick={() => setMode('signUp')}>Create an account</button>
              <button className="text-button" type="button" onClick={() => setMode('recover')}>Forgot password?</button>
            </>
          ) : (
            <button className="text-button" type="button" onClick={() => setMode('signIn')}>Back to sign in</button>
          )}
        </div>
        </form>
        <p className="fine-print">Private by default. Safety notifications cannot be disabled.</p>
      </section>
    </main>
  );
}
