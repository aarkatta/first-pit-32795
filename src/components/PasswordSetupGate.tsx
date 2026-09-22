import { useState, type FormEvent } from 'react';
import type { Auth, User } from 'firebase/auth';
import { StatePanel } from './StatePanel';
import { signOutCurrentUser } from '@/lib/auth';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { describePasswordProblem, MIN_MEMBER_PASSWORD_LENGTH, setInitialPassword } from '@/lib/team-members';

type PasswordSetupGateProps = {
  user: User;
  auth: Auth | null;
  online: boolean;
};

/**
 * Makes a coach-provisioned member replace the password their coach gave them.
 *
 * This runs in front of every protected route rather than as a reminder banner,
 * because until it is done the credential is a shared secret: it passed through
 * the coach's own mailbox to reach the member. The member choosing their own
 * password is what turns it back into something only they know, and it is also
 * this product's stand-in for the invitation flow's proof-of-address step.
 *
 * `setInitialPassword` refuses unless the server still has `mustSetPassword`
 * set, so nothing here is the authorization — the gate is the explanation.
 */
export function PasswordSetupGate({ user, auth, online }: PasswordSetupGateProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Shown only once the field has content, so the form does not open by telling
  // a child they have done something wrong.
  const problem = password ? describePasswordProblem(password, user.email) : null;
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const submittable = !problem && !mismatch && password.length > 0 && confirmation === password;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submittable) return;
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    void setInitialPassword(password)
      .then(() => {
        // The profile listener clears `mustSetPassword` and ProtectedRoute lets
        // them through on the next render; nothing to navigate here.
        setPassword('');
        setConfirmation('');
      })
      .catch((error: unknown) => setRequestState(getRequestState(error, online)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="page-stack">
      <section className="feature-panel" aria-labelledby="password-setup-heading">
        <span className="eyebrow">ONE STEP LEFT</span>
        <h3 id="password-setup-heading">Choose your own password</h3>
        <p>
          Your coach set up this account for {user.email} and gave you a starter password.
          Pick a new one that only you know, and you are in.
        </p>

        {!online ? (
          <StatePanel
            variant="offline"
            title="You are offline"
            message="Reconnect to save your new password."
          />
        ) : null}
        {requestState ? <StatePanel {...requestState} autoFocus /> : null}

        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="new-password">
            New password
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="new-password-hint"
              aria-invalid={problem ? true : undefined}
              required
            />
          </label>
          <p id="new-password-hint"><small>{problem ?? `At least ${MIN_MEMBER_PASSWORD_LENGTH} characters. A few words together, like "my robot is fast", works well.`}</small></p>

          <label htmlFor="confirm-password">
            Type it again
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-describedby="confirm-password-hint"
              aria-invalid={mismatch ? true : undefined}
              required
            />
          </label>
          <p id="confirm-password-hint" role={mismatch ? 'alert' : undefined}>
            <small>{mismatch ? 'These two do not match yet.' : 'So a typo cannot lock you out.'}</small>
          </p>

          <div className="form-actions">
            <button className="button" type="submit" disabled={busy || !submittable || !online}>
              {busy ? 'Saving…' : 'Save and continue'}
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={signingOut || !auth}
              onClick={() => {
                if (!auth) return;
                setSigningOut(true);
                void signOutCurrentUser(auth).finally(() => setSigningOut(false));
              }}
            >
              {signingOut ? 'Signing out…' : 'Not you? Sign out'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
