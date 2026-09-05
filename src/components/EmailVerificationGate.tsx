import { useState } from 'react';
import type { Auth, User } from 'firebase/auth';
import { StatePanel } from './StatePanel';
import { resendVerificationEmail, signOutCurrentUser } from '@/lib/auth';

type EmailVerificationGateProps = {
  user: User;
  auth: Auth | null;
  online: boolean;
};

/**
 * Blocks a password account that has not proved it owns its email address.
 *
 * This runs in front of every protected route rather than as a banner: an
 * unverified address is how an invitation could be accepted by someone who
 * does not control it, which matters more here than in a general-purpose app
 * because the invitation grants access to a team of minors.
 *
 * A verified user is not re-rendered here, so the only exits are verifying,
 * or signing out.
 */
export function EmailVerificationGate({ user, auth, online }: EmailVerificationGateProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setNotice(null);
    setFailed(null);
    try {
      await resendVerificationEmail(user);
      setNotice(`A new verification email is on its way to ${user.email ?? 'your address'}.`);
    } catch {
      setFailed('The verification email could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    setNotice(null);
    setFailed(null);
    try {
      await user.reload();
      if (user.emailVerified) {
        // `reload()` mutates the existing User in place and fires no auth state
        // change, so nothing above would re-render. A reload is a blunt but
        // reliable way to re-enter the app, and this happens once per account.
        window.location.reload();
        return;
      }
      setFailed('That address is still unverified. Open the link in the email first.');
    } catch {
      setFailed('Your verification status could not be checked. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">VERIFY YOUR EMAIL</p>
      <h1>Confirm {user.email ?? 'your email address'}</h1>
      <p>
        First Pit sent you a verification link. Open it to confirm this address, then continue. Verifying protects your
        team: an invitation should only ever reach the person who owns the address it was sent to.
      </p>
      {notice ? <StatePanel variant="success" title="Email sent" message={notice} /> : null}
      {failed ? <StatePanel variant="error" title="Not verified yet" message={failed} /> : null}
      {!online ? <StatePanel variant="offline" title="You are offline" message="Reconnect to check your verification status." /> : null}
      <div className="form-actions">
        <button className="button" type="button" onClick={() => void recheck()} disabled={busy || !online}>
          {busy ? 'Checking…' : 'I have verified — continue'}
        </button>
        <button className="button secondary" type="button" onClick={() => void resend()} disabled={busy || !online}>
          Resend verification email
        </button>
        <button className="button button--ghost" type="button" disabled={busy || !auth} onClick={() => void (auth && signOutCurrentUser(auth))}>
          Sign out
        </button>
      </div>
    </section>
  );
}
