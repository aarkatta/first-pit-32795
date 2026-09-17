import { useCallback, useEffect, useState } from 'react';
import type { Auth, User } from 'firebase/auth';
import { StatePanel } from './StatePanel';
import { authEmailSender, refreshVerificationStatus, resendVerificationEmail, signOutCurrentUser } from '@/lib/auth';
import { latestVerificationLink, usingAuthEmulator } from '@/lib/auth-emulator';

type EmailVerificationGateProps = {
  user: User;
  auth: Auth | null;
  online: boolean;
  /** The path to return to once the address is verified. */
  next?: string;
};

/** How often the gate re-asks the server while the tab is visible. */
const POLL_MS = 4000;

/**
 * Blocks a password account that has not proved it owns its email address.
 *
 * This runs in front of every protected route rather than as a banner: an
 * unverified address is how an invitation could be accepted by someone who
 * does not control it, which matters more here than in a general-purpose app
 * because the invitation grants access to a team of minors.
 *
 * The usual path out is clicking the link in the email, which lands on
 * `/auth/action` and finishes there. This gate covers the case where that
 * happened somewhere else — another browser, a phone — by re-asking the
 * server on a timer and whenever the tab is focused, so a user who verifies
 * on their phone finds the desktop tab already through.
 */
export function EmailVerificationGate({ user, auth, online, next = '/hub' }: EmailVerificationGateProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const sender = authEmailSender(auth);

  /**
   * `reload()` mutates the existing `User` in place and fires no auth state
   * change, so nothing above this would re-render. A full page load is blunt
   * but reliable, and happens once per account.
   */
  const admitIfVerified = useCallback(async (): Promise<boolean> => {
    const verified = await refreshVerificationStatus(user);
    if (verified) window.location.assign(next);
    return verified;
  }, [next, user]);

  // Poll while the tab is visible and online, and re-check immediately on
  // focus so returning from the inbox does not also need a button press.
  useEffect(() => {
    if (!online) return undefined;
    let active = true;

    const check = () => {
      if (!active || document.visibilityState !== 'visible') return;
      void admitIfVerified().catch(() => undefined);
    };

    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [admitIfVerified, online]);

  // The Auth emulator records verification codes but never sends mail, so
  // locally the link has to come from the emulator itself or the gate is a
  // dead end for every developer.
  useEffect(() => {
    if (!usingAuthEmulator() || !user.email) return undefined;
    let active = true;
    void latestVerificationLink(user.email)
      .then((link) => {
        if (active) setDevLink(link);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [notice, user.email]);

  async function resend() {
    setBusy(true);
    setNotice(null);
    setFailed(null);
    try {
      await resendVerificationEmail(user, next);
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
      if (await admitIfVerified()) return;
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
        First Pit sent you a verification link. Open it to confirm this address — this page continues on its own once you
        do. Verifying protects your team: an invitation should only ever reach the person who owns the address it was
        sent to.
      </p>
      {/*
        The mail comes from Firebase's default noreply@ sender on a domain the
        recipient has never corresponded with, which is close to a worst case
        for spam filters — every tester found it filed under junk and reported
        the email as never sent. Saying so up front, and naming the sender so it
        can be searched for, is cheaper than the support thread.
      */}
      <p className="fine-print">
        No email yet? Check your spam or junk folder{sender ? <> and search for <strong>{sender}</strong></> : null}, then
        mark it as not spam so later First Pit mail reaches your inbox.
      </p>
      {notice ? <StatePanel variant="success" title="Email sent" message={notice} /> : null}
      {failed ? <StatePanel variant="error" title="Not verified yet" message={failed} /> : null}
      {!online ? <StatePanel variant="offline" title="You are offline" message="Reconnect to check your verification status." /> : null}
      {devLink ? (
        <p className="fine-print">
          Emulator: no mail is delivered locally. <a href={devLink}>Open the verification link</a>.
        </p>
      ) : null}
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
