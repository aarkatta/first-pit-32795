import { useState, type FormEvent } from 'react';
import { StatePanel } from '@/components/StatePanel';
import { copyToClipboard } from '@/lib/clipboard';
import { createOperationId } from '@/lib/ids';
import { inviteEmailBody, inviteEmailSubject, inviteGmailHref, inviteLink, type InviteEmailInput } from '@/lib/invite-email';
import { shareText } from '@/lib/native-links';
import { isNativeShell } from '@/lib/native-shell';
import { createInvitation } from '@/lib/phase2-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { isExistingAccountError, provisionTeamMember, type ProvisionableRole, type ProvisionedMember } from '@/lib/team-members';

type AddMemberDialogProps = {
  teamId: string;
  teamName: string;
  teamNumber?: string | null;
  coachName?: string | null;
  online: boolean;
  onAdded: (member: ProvisionedMember) => void;
  onCancel: () => void;
};

const ROLE_OPTIONS: Array<{ value: ProvisionableRole; label: string; hint: string }> = [
  { value: 'student', label: 'Student', hint: 'Works the board: adds, edits and moves tasks.' },
  { value: 'mentor', label: 'Mentor', hint: 'Views the board, helps in the knowledge base.' },
  { value: 'parent', label: 'Parent', hint: 'Views the board and asks questions.' },
  { value: 'coach', label: 'Coach', hint: 'Full administration, like you.' }
];

/**
 * The one way to add someone to a team.
 *
 * Two mechanisms sit behind this single form, and the coach never has to know
 * which applies. An address with no First Pit account is provisioned outright.
 * An address that already has one cannot be — attaching someone's existing
 * account to a team without them acting is what invitations exist to prevent —
 * so the refusal turns into an invitation offered right here, rather than an
 * error sending the coach to another page to retype everything.
 *
 * The address is typed twice on purpose. Under the invitation flow a typo was
 * inert: the invitation simply became unreadable and expired. Provisioning
 * makes a working account whose credentials a coach is about to email, so
 * confirming the address is the compensating control for the proof-of-address
 * step this path does not have.
 */
export function AddMemberDialog({ teamId, teamName, teamNumber, coachName, online, onAdded, onCancel }: AddMemberDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [role, setRole] = useState<ProvisionableRole>('student');
  const [busy, setBusy] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  /** Set when provisioning was refused because the address already has an account. */
  const [existingAccount, setExistingAccount] = useState(false);
  const [invitation, setInvitation] = useState<{ id: string; email: string; role: string; copied: boolean } | null>(null);
  // Held across retries so a resubmit after a timeout replays rather than
  // creating a second account.
  const [operationId, setOperationId] = useState(() => createOperationId('provision'));
  const nativeShell = isNativeShell();

  const normalizedEmail = email.trim().toLowerCase();
  const mismatch = confirmEmail.trim().length > 0 && confirmEmail.trim().toLowerCase() !== normalizedEmail;
  const submittable = displayName.trim().length >= 2 && normalizedEmail.includes('@') && !mismatch && confirmEmail.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submittable) return;
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    setExistingAccount(false);
    void provisionTeamMember(teamId, { displayName: displayName.trim(), email: normalizedEmail, role }, operationId)
      .then((member) => {
        // A fresh id for the next member the coach adds in this sitting.
        setOperationId(createOperationId('provision'));
        onAdded(member);
      })
      .catch((error: unknown) => {
        if (isExistingAccountError(error)) {
          setExistingAccount(true);
          return;
        }
        setRequestState(getRequestState(error, online));
      })
      .finally(() => setBusy(false));
  }

  function sendInvitation() {
    setBusy(true);
    setRequestState(null);
    void createInvitation(teamId, normalizedEmail, role)
      .then(async ({ invitationId }) => {
        const copied = await copyToClipboard(inviteLink(invitationId));
        setExistingAccount(false);
        setInvitation({ id: invitationId, email: normalizedEmail, role, copied });
      })
      .catch((error: unknown) => setRequestState(getRequestState(error, online)))
      .finally(() => setBusy(false));
  }

  function invitationEmail(): InviteEmailInput {
    return {
      email: invitation?.email ?? normalizedEmail,
      link: inviteLink(invitation?.id ?? ''),
      role: invitation?.role ?? role,
      teamName,
      teamNumber,
      inviterName: coachName
    };
  }

  if (invitation) {
    const message = invitationEmail();
    return (
      <section className="feature-panel" aria-labelledby="add-member-heading">
        <span className="eyebrow">INVITATION CREATED</span>
        <h3 id="add-member-heading">{invitation.email} has been invited</h3>
        <p>
          First Pit does not send email itself. Send them this link — it works for 7 days, and
          only when they sign in as {invitation.email}.
          {invitation.copied ? ' It is already on your clipboard.' : ''}
        </p>
        <p><code className="invite-link">{message.link}</code></p>
        <div className="form-actions">
          {nativeShell ? (
            <button className="button" type="button" onClick={() => void shareText({ title: inviteEmailSubject(message), text: inviteEmailBody(message) }).catch((error: unknown) => setRequestState(getRequestState(error, online)))}>
              Send invite
            </button>
          ) : (
            <a className="button" href={inviteGmailHref(message)} target="_blank" rel="noopener noreferrer">Email invite with Gmail</a>
          )}
          <button className="button button--ghost" type="button" onClick={() => void copyToClipboard(message.link)}>Copy link</button>
          <button className="button button--ghost" type="button" onClick={onCancel}>Done</button>
        </div>
        {requestState ? <StatePanel {...requestState} /> : null}
      </section>
    );
  }

  return (
    <section className="feature-panel" aria-labelledby="add-member-heading">
      <span className="eyebrow">ADD A TEAM MEMBER</span>
      <h3 id="add-member-heading">Create their account</h3>
      <p>
        First Pit makes the account and gives you a starter password to pass on. They
        choose their own the first time they sign in.
      </p>

      {requestState ? <StatePanel {...requestState} autoFocus /> : null}

      {existingAccount ? (
        <div className="existing-account" role="alert">
          <p>
            <strong>{normalizedEmail} already has a First Pit account.</strong> First Pit cannot
            create a second one, and it will not add an existing account to your team without that
            person agreeing — so invite them instead. They accept it themselves and keep the
            password they already use.
          </p>
          <div className="form-actions">
            <button className="button" type="button" disabled={busy || !online} onClick={sendInvitation}>
              {busy ? 'Creating…' : `Invite ${normalizedEmail} as a ${role}`}
            </button>
            <button className="button button--ghost" type="button" disabled={busy} onClick={() => setExistingAccount(false)}>
              Use a different address
            </button>
          </div>
        </div>
      ) : null}

      <form className="form-stack" onSubmit={submit}>
        <label htmlFor="member-name">
          Full name
          <input id="member-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={80} autoComplete="off" autoFocus required />
        </label>

        <label htmlFor="member-email">
          Email address
          <input id="member-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setExistingAccount(false); }} autoComplete="off" aria-describedby="member-email-hint" required />
        </label>
        <p id="member-email-hint"><small>Theirs, or a parent's. This is the address they sign in with, and the only way they can recover the account themselves.</small></p>

        <label htmlFor="member-email-confirm">
          Type the email again
          <input
            id="member-email-confirm"
            type="email"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            autoComplete="off"
            aria-invalid={mismatch ? true : undefined}
            aria-describedby="member-email-confirm-hint"
            required
          />
        </label>
        <p id="member-email-confirm-hint" role={mismatch ? 'alert' : undefined}>
          <small>{mismatch ? 'These two addresses do not match.' : 'A typo here would send their password to a stranger.'}</small>
        </p>

        <fieldset className="role-choice">
          <legend>Role</legend>
          {ROLE_OPTIONS.map((option) => (
            <label key={option.value} className="role-choice__option">
              <input type="radio" name="member-role" value={option.value} checked={role === option.value} onChange={() => setRole(option.value)} />
              <span><strong>{option.label}</strong><small>{option.hint}</small></span>
            </label>
          ))}
        </fieldset>

        <div className="form-actions">
          <button className="button" type="submit" disabled={busy || !submittable || !online}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
