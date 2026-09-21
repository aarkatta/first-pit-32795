import { useState, type FormEvent } from 'react';
import { StatePanel } from '@/components/StatePanel';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { provisionTeamMember, type ProvisionableRole, type ProvisionedMember } from '@/lib/team-members';
import { createOperationId } from '@/lib/ids';

type AddMemberDialogProps = {
  teamId: string;
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
 * Creates a member's account there and then.
 *
 * The address is typed twice on purpose. Under the invitation flow a typo was
 * inert — the invitation simply became unreadable and expired. Here it produces
 * a working account whose credentials a coach is about to email, so confirming
 * the address is the compensating control for the verification step this path
 * does not have.
 */
export function AddMemberDialog({ teamId, online, onAdded, onCancel }: AddMemberDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [role, setRole] = useState<ProvisionableRole>('student');
  const [busy, setBusy] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  // Held across retries so a resubmit after a timeout replays rather than
  // creating a second account.
  const [operationId, setOperationId] = useState(() => createOperationId('provision'));

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
    void provisionTeamMember(teamId, { displayName: displayName.trim(), email: normalizedEmail, role }, operationId)
      .then((member) => {
        // A fresh id for the next member the coach adds in this sitting.
        setOperationId(createOperationId('provision'));
        onAdded(member);
      })
      .catch((error: unknown) => setRequestState(getRequestState(error, online)))
      .finally(() => setBusy(false));
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

      <form className="form-stack" onSubmit={submit}>
        <label htmlFor="member-name">
          Full name
          <input id="member-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={80} autoComplete="off" autoFocus required />
        </label>

        <label htmlFor="member-email">
          Email address
          <input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" aria-describedby="member-email-hint" required />
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
