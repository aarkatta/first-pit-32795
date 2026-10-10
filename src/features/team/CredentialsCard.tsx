import { useState } from 'react';
import { copyToClipboard } from '@/lib/clipboard';
import { credentialsMessage, credentialsSubject } from '@/lib/member-credentials';
import { publicWebOrigin } from '@/lib/public-origin';
import type { ProvisionedMember } from '@/lib/team-members';

type CredentialsCardProps = {
  member: ProvisionedMember;
  /** Whether the card follows Add a member or Reset password. */
  kind?: 'added' | 'reset';
  teamName: string;
  teamNumber?: string | null;
  coachName?: string | null;
  onDone: () => void;
};

/**
 * What a coach passes on after adding a member or resetting their password.
 *
 * The starter password is the same for every member (`DEFAULT_MEMBER_PASSWORD`
 * in `functions/src/team-members.ts`), so the card's job is the message and the
 * nudge to sign in soon — an account still on it is only as private as the
 * member's email address.
 *
 * The highlighted confirmation is for the coach only: it is not part of
 * `credentialsMessage`, the text they copy and send on.
 */
export function CredentialsCard({ member, kind = 'added', teamName, teamNumber, coachName, onDone }: CredentialsCardProps) {
  const [copied, setCopied] = useState<'message' | 'password' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  if (!member.temporaryPassword) {
    // A replayed request: nothing was created or reset this time.
    return (
      <section className="feature-panel" aria-labelledby="credentials-heading">
        <span className="eyebrow">ALREADY CREATED</span>
        <h3 id="credentials-heading">{member.displayName} already has an account</h3>
        <p>This request had already gone through, so there is no new password to show. Use <strong>Reset password</strong> on the roster to issue one.</p>
        <div className="form-actions"><button className="button" type="button" onClick={onDone}>Done</button></div>
      </section>
    );
  }

  const message = credentialsMessage({
    displayName: member.displayName,
    email: member.email,
    temporaryPassword: member.temporaryPassword,
    teamName,
    teamNumber,
    coachName
  });

  async function runCopy(kind: 'message' | 'password', text: string) {
    const ok = await copyToClipboard(text);
    setCopied(ok ? kind : null);
    setCopyFailed(!ok);
  }

  return (
    <section className="feature-panel credentials-card" aria-labelledby="credentials-heading">
      <span className="eyebrow">STARTER PASSWORD</span>
      <h3 id="credentials-heading">{kind === 'reset' ? `${member.displayName}'s password was reset` : `${member.displayName} is on the team`}</h3>
      <p className="credentials-card__success" role="status">
        <strong>{kind === 'reset' ? 'Password reset successfully!' : 'Member added successfully!'}</strong>{' '}
        They can log in using their email and the temporary password: <strong>{member.temporaryPassword}</strong> on{' '}
        <strong>{new URL(publicWebOrigin()).host}</strong>. They will be required to change it upon their {kind === 'reset' ? 'next' : 'first'} login.
      </p>
      <p>
        First Pit does not email them — pass these details on yourself, and ask them to sign in soon.
      </p>

      <dl className="credentials-card__fields">
        <dt>Email</dt>
        <dd><code>{member.email}</code></dd>
        <dt>Starter password</dt>
        <dd><code className="credentials-card__password">{member.temporaryPassword}</code></dd>
      </dl>

      <div className="form-actions">
        <button className="button" type="button" onClick={() => void runCopy('message', `${credentialsSubject({ teamName, teamNumber })}\n\n${message}`)}>
          Copy the whole message
        </button>
        <button className="button button--ghost" type="button" onClick={() => void runCopy('password', member.temporaryPassword ?? '')}>
          Copy just the password
        </button>
        <button className="button button--ghost" type="button" onClick={onDone}>Done</button>
      </div>

      {copied ? <p role="status"><small>{copied === 'message' ? 'Message copied — paste it into an email to them.' : 'Password copied.'}</small></p> : null}
      {copyFailed ? <p role="alert"><small>Your browser would not let First Pit use the clipboard. Select the text above and copy it by hand.</small></p> : null}

      <details className="credentials-card__preview">
        <summary>Show the message</summary>
        <pre>{message}</pre>
      </details>
    </section>
  );
}
