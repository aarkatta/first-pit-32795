import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { resendVerificationEmail } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { formatDateTimeLabel, toDate } from '@/lib/dates';
import type { InvitationStatus } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';
import { acceptInvitation, requestToJoinTeam } from '@/lib/phase2-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * The invitee side of the membership flow.
 *
 * A coach creates an `invitations/{id}` document and shares `/join?invite=<id>`.
 * Nothing else in the app reads that collection, so without this screen an
 * invitation can be sent but never accepted and a team can never gain a second
 * member. The same page also carries the "request to join" path for a team that
 * has turned on coach approval, because team discovery is deliberately private —
 * the coach passes the team id along, there is no directory to browse.
 *
 * `acceptInvitation` hard-requires a verified email address on the ID token, and
 * so does the Firestore read rule for the invitation itself. That failure is
 * detected up front and explained, rather than surfacing as a raw
 * permission-denied error the invitee cannot act on.
 */
type InvitationView = {
  id: string;
  teamId: string;
  teamName: string | null;
  email: string;
  role: string;
  status: InvitationStatus;
  expiresAt: unknown;
};

type LookupStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

async function loadInvitation(firestore: Firestore, invitationId: string): Promise<InvitationView | null> {
  const snapshot = await getDoc(doc(firestore, 'invitations', invitationId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  const teamId = String(data.teamId ?? '');
  // `createInvitation` denormalizes the team name onto the invitation precisely
  // because the invitee is not a member yet and so cannot read `teams/{teamId}`.
  // Invitations written before that field existed fall back to a direct read
  // (which succeeds only for someone already on the team) and then to the id.
  let teamName: string | null = String(data.teamName ?? '').trim() || null;
  if (!teamName && teamId) {
    try {
      const team = await getDoc(doc(firestore, 'teams', teamId));
      teamName = team.exists() ? String((team.data() as Record<string, unknown>).name ?? '') || null : null;
    } catch {
      teamName = null;
    }
  }
  return {
    id: snapshot.id,
    teamId,
    teamName,
    email: String(data.email ?? ''),
    role: String(data.role ?? 'student'),
    status: (data.status ?? 'pending') as InvitationStatus,
    expiresAt: data.expiresAt
  };
}

function expiryLabel(invitation: InvitationView): string {
  const expiry = toDate(invitation.expiresAt);
  if (!expiry) return 'No expiry recorded';
  if (expiry.getTime() < Date.now()) return `Expired ${formatDateTimeLabel(expiry)}`;
  return `Expires ${formatDateTimeLabel(expiry)}`;
}

function statusExplanation(status: InvitationStatus): string {
  if (status === 'accepted') return 'This invitation has already been accepted.';
  if (status === 'revoked') return 'A coach revoked this invitation. Ask them to send a new one.';
  if (status === 'expired') return 'This invitation expired. Ask a coach to send a new one.';
  return '';
}

export function JoinTeamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [searchParams] = useSearchParams();
  const firestore = getFirebaseServices().firestore;
  const linkedInvitationId = (searchParams.get('invite') ?? '').trim();

  const [invitationId, setInvitationId] = useState(linkedInvitationId);
  const [invitationInput, setInvitationInput] = useState(linkedInvitationId);
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>('idle');
  const [lookupError, setLookupError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [teamIdInput, setTeamIdInput] = useState('');
  const [busy, setBusy] = useState(false);
  // `user.reload()` mutates the Firebase User in place and does not fire the auth
  // listener, so the verified flag has to be mirrored in state for the screen to
  // react when the invitee confirms their address in another tab.
  const [emailVerified, setEmailVerified] = useState(user?.emailVerified === true);

  const locked = busy || !online;
  const lookupState = lookupStatus === 'error' ? getRequestState(lookupError, online) : null;

  const lookup = useCallback(async () => {
    if (!invitationId || !emailVerified) return;
    setLookupStatus('loading');
    setLookupError(null);
    try {
      const found = await loadInvitation(firestore, invitationId);
      setInvitation(found);
      setLookupStatus(found ? 'ready' : 'missing');
    } catch (nextError) {
      setInvitation(null);
      setLookupError(nextError instanceof Error ? nextError : new Error('The invitation could not be loaded.'));
      setLookupStatus('error');
    }
  }, [emailVerified, firestore, invitationId]);

  useEffect(() => { void lookup(); }, [lookup]);
  useEffect(() => { setEmailVerified(user?.emailVerified === true); }, [user]);

  async function run(action: () => Promise<unknown>) {
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    setNotice(null);
    try {
      await action();
    } catch (nextError) {
      setRequestState(getRequestState(nextError, online));
    } finally {
      setBusy(false);
    }
  }

  function submitInvitationId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvitationId(invitationInput.trim());
  }

  function submitJoinRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedTeamId = teamIdInput.trim();
    if (!requestedTeamId) return;
    void run(async () => {
      await requestToJoinTeam(requestedTeamId);
      setTeamIdInput('');
      setNotice('Your request was sent. A coach reviews it in team administration before you get access.');
    });
  }

  function acceptCurrentInvitation() {
    if (!invitation) return;
    void run(async () => {
      await acceptInvitation(invitation.id);
      navigate('/hub', { replace: true });
    });
  }

  async function refreshVerification() {
    if (!user) return;
    setBusy(true);
    setRequestState(null);
    try {
      await user.reload();
      // The `email_verified` claim lives on the ID token, so a fresh token is
      // what actually unblocks both the Firestore read and the callable.
      await user.getIdToken(true);
      setEmailVerified(user.emailVerified);
      if (user.emailVerified) setNotice('Email verified. You can accept your invitation now.');
      else setNotice('This account is still unverified. Open the verification email, then check again.');
    } catch (nextError) {
      setRequestState(getRequestState(nextError, online));
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <StatePanel
        variant="permission"
        title="Sign in to join a team"
        message="Sign in with the email address the invitation was sent to, then reopen this link."
      />
    );
  }

  return (
    <div className="page-stack">
      <section className="team-hero">
        <div>
          <span className="eyebrow light">JOIN A TEAM</span>
          <h3>Accept an invitation</h3>
          <p>Signed in as {user.email ?? 'your account'}. Invitations are bound to that address.</p>
        </div>
      </section>

      {!online ? (
        <StatePanel
          variant="offline"
          title="You are offline"
          message="Reconnect to load your invitation and join a team."
          actionLabel="Try again"
          onAction={() => void lookup()}
        />
      ) : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      {notice ? <StatePanel variant="success" title="Membership" message={notice} actionLabel="Dismiss" onAction={() => setNotice(null)} /> : null}

      {!emailVerified ? (
        <article className="feature-panel">
          <span className="eyebrow">VERIFY YOUR EMAIL</span>
          <h3>Confirm {user.email ?? 'your address'} first</h3>
          <p>
            An invitation can only be accepted by a verified address, so nobody can claim a team place with an email they
            do not own. Open the verification link we emailed you, then come back and check again.
          </p>
          <div className="form-actions">
            <button
              className="button"
              type="button"
              disabled={locked}
              onClick={() => void run(async () => {
                await resendVerificationEmail(user);
                setNotice('Verification email sent. Check your inbox and spam folder.');
              })}
            >
              Resend verification email
            </button>
            <button className="button button--ghost" type="button" disabled={locked} onClick={() => void refreshVerification()}>
              I have verified — check again
            </button>
          </div>
        </article>
      ) : null}

      <section className="split-panels">
        <article className="feature-panel">
          <span className="eyebrow">INVITATION</span>
          <h3>Your invitation</h3>
          <form className="form-stack" onSubmit={submitInvitationId}>
            <label>
              Invitation ID
              <input
                value={invitationInput}
                onChange={(event) => setInvitationInput(event.target.value)}
                placeholder="Paste the ID from your invitation link"
                autoComplete="off"
              />
            </label>
            <button className="button button--ghost" type="submit" disabled={busy || !invitationInput.trim()}>Look up invitation</button>
          </form>

          {!emailVerified ? (
            <p><small>Verify your email address above to load the invitation.</small></p>
          ) : !invitationId ? (
            <StatePanel
              variant="empty"
              title="No invitation loaded"
              message="Open the /join link a coach sent you, or paste the invitation ID above."
            />
          ) : lookupStatus === 'loading' ? (
            <StatePanel variant="loading" title="Loading invitation" message="Checking the invitation you were sent." />
          ) : lookupStatus === 'missing' ? (
            <StatePanel
              variant="empty"
              title="Invitation not found"
              message="No invitation matches that ID for your email address. Ask a coach to send a new one."
            />
          ) : lookupState ? (
            <StatePanel
              {...lookupState}
              title={lookupState.variant === 'permission' ? 'This invitation is not for your account' : 'Invitation could not load'}
              message={
                lookupState.variant === 'permission'
                  ? 'Invitations are readable only by the address they were sent to. Sign in with that email address, or ask a coach to reissue the invitation.'
                  : lookupState.message
              }
              actionLabel="Retry"
              onAction={() => void lookup()}
              autoFocus
            />
          ) : invitation ? (
            <>
              <div className="list-row">
                <span>
                  <strong>{invitation.teamName ?? `Team ${invitation.teamId}`}</strong>
                  <small>Role offered: {invitation.role}</small>
                </span>
                <span>
                  <small>{invitation.status}</small>
                  <small>{expiryLabel(invitation)}</small>
                </span>
              </div>
              <p><small>Invited address: {invitation.email}</small></p>
              {invitation.status === 'pending' ? (
                <div className="form-actions">
                  <button className="button" type="button" disabled={locked} onClick={acceptCurrentInvitation}>
                    {busy ? 'Joining…' : `Accept and join as ${invitation.role}`}
                  </button>
                </div>
              ) : (
                <StatePanel variant="empty" title="Invitation unavailable" message={statusExplanation(invitation.status)} />
              )}
            </>
          ) : null}
        </article>

        <article className="feature-panel">
          <span className="eyebrow">REQUEST TO JOIN</span>
          <h3>No invitation yet?</h3>
          <p>
            Teams are private and never listed publicly, so a coach has to give you the team ID. If the team accepts join
            requests, your request lands in their approval queue.
          </p>
          <form className="form-stack" onSubmit={submitJoinRequest}>
            <label>
              Team ID
              <input
                value={teamIdInput}
                onChange={(event) => setTeamIdInput(event.target.value)}
                placeholder="Team ID shared by your coach"
                autoComplete="off"
              />
            </label>
            <button className="button" type="submit" disabled={locked || !teamIdInput.trim()}>{busy ? 'Sending…' : 'Request to join'}</button>
          </form>
          <p><small>A coach approves or rejects every request. Nothing is shared with the team until they do.</small></p>
        </article>
      </section>
    </div>
  );
}
