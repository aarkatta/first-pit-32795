import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import {
  applyEmailActionCode,
  checkPasswordResetCode,
  completePasswordReset,
  isSpentActionCode,
  parseEmailActionMode,
  refreshVerificationStatus
} from '@/lib/auth';
import { useOnlineStatus } from '@/lib/use-online-status';

type Phase =
  | { kind: 'working' }
  | { kind: 'verified'; email: string | null }
  | { kind: 'password'; email: string }
  | { kind: 'passwordDone' }
  | { kind: 'failed'; title: string; message: string }
  | { kind: 'unsupported' };

const SPENT_CODE = {
  title: 'This link is no longer valid',
  message: 'Verification links expire and can only be used once. Sign in and request a new one.'
};

/**
 * Handles the links Firebase Auth mails out (`?mode=…&oobCode=…`).
 *
 * Firebase's own hosted handler works, but it ends outside the app: the user
 * is told the address is verified and then has to find First Pit again and
 * convince it separately. This page applies the code and refreshes the signed
 * in session in one step, so clicking the link in the email is the whole
 * flow. Point Authentication → Templates → "customize action URL" at
 * `<origin>/auth/action` in the Firebase console to route emails here; until
 * then this page still serves as the continue-URL landing after the hosted
 * handler runs.
 *
 * Deliberately outside `ProtectedRoute`: a code from an email arrives in
 * whatever browser opened it, often with no session at all.
 */
export function AuthActionPage() {
  const [params] = useSearchParams();
  const { auth, user, status } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const oobCode = params.get('oobCode');
  const mode = parseEmailActionMode(params.get('mode'));
  // Firebase's hosted handler forwards to the continue URL with its own
  // parameters stripped; `next` is ours, added when the email was sent.
  const next = params.get('next') || '/team';

  const settle = useCallback(async (email: string | null) => {
    // The signed-in User still carries the stale `emailVerified: false` it was
    // persisted with. Refreshing here is what lets the app open without the
    // gate reappearing.
    if (user) await refreshVerificationStatus(user).catch(() => undefined);
    setPhase({ kind: 'verified', email });
  }, [user]);

  useEffect(() => {
    // `auth` is null only until AuthProvider has resolved; wait rather than
    // reporting a failure the user cannot act on.
    if (!auth || status === 'loading') return undefined;
    let active = true;

    async function run() {
      if (!auth) return;
      // No code: this is the continue-URL landing after the hosted handler
      // already applied it. Nothing to consume, just re-read the session.
      if (!oobCode) {
        await settle(null);
        return;
      }
      if (!mode) {
        if (active) setPhase({ kind: 'unsupported' });
        return;
      }
      try {
        if (mode === 'resetPassword') {
          const email = await checkPasswordResetCode(auth, oobCode);
          if (active) setPhase({ kind: 'password', email });
          return;
        }
        await applyEmailActionCode(auth, oobCode);
        if (!active) return;
        await settle(null);
      } catch (error) {
        if (!active) return;
        if (isSpentActionCode(error)) {
          setPhase({ kind: 'failed', ...SPENT_CODE });
          return;
        }
        setPhase({
          kind: 'failed',
          title: 'We could not finish that request',
          message: online
            ? 'Something went wrong applying this link. Try opening it again.'
            : 'You appear to be offline. Reconnect and open the link again.'
        });
      }
    }

    void run();
    return () => {
      active = false;
    };
    // `settle` closes over `user`; re-running once the session arrives is what
    // clears a stale verification flag for a user who was already signed in.
  }, [auth, mode, oobCode, online, settle, status]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !oobCode) return;
    setBusy(true);
    try {
      await completePasswordReset(auth, oobCode, password);
      setPhase({ kind: 'passwordDone' });
    } catch (error) {
      setPhase(isSpentActionCode(error)
        ? { kind: 'failed', ...SPENT_CODE }
        : { kind: 'failed', title: 'Password not changed', message: 'That password could not be saved. Use at least six characters and try again.' });
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  function heading(): string {
    switch (mode) {
      case 'resetPassword': return 'Choose a new password';
      case 'recoverEmail': return 'Restore your email address';
      default: return 'Confirming your email address';
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="card auth-card">
        <p className="eyebrow">ACCOUNT</p>
        <h1>{heading()}</h1>

        {phase.kind === 'working' ? (
          <StatePanel variant="loading" title="Checking your link" message="First Pit is confirming this link with the authentication service." />
        ) : null}

        {phase.kind === 'verified' ? (
          <>
            <StatePanel
              variant="success"
              title="Email confirmed"
              message={phase.email
                ? `${phase.email} is verified. You can use First Pit on this device.`
                : 'Your email address is verified. You can use First Pit on this device.'}
            />
            {status === 'authenticated' ? (
              <div className="form-actions">
                <button className="button" type="button" onClick={() => navigate(next, { replace: true })}>Continue</button>
              </div>
            ) : (
              <p>Sign in to continue. <Link className="button" to={`/auth?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
            )}
          </>
        ) : null}

        {phase.kind === 'password' ? (
          <form className="onboarding-content" onSubmit={submitPassword}>
            <p>Set a new password for {phase.email}.</p>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>
            <button className="submit-button" type="submit" disabled={busy || !online}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        ) : null}

        {phase.kind === 'passwordDone' ? (
          <>
            <StatePanel variant="success" title="Password updated" message="Sign in with your new password." />
            <Link className="button" to="/auth">Sign in</Link>
          </>
        ) : null}

        {phase.kind === 'unsupported' ? (
          <>
            <StatePanel variant="error" title="Unrecognized link" message="This link is not one First Pit can complete. Open the most recent email, or request a new one." />
            <Link className="button" to="/auth">Back to sign in</Link>
          </>
        ) : null}

        {phase.kind === 'failed' ? (
          <>
            <StatePanel variant="error" title={phase.title} message={phase.message} />
            <Link className="button" to="/auth">Back to sign in</Link>
          </>
        ) : null}
      </section>
    </main>
  );
}
