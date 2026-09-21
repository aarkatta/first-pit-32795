import { useState } from 'react';
import { credentialsMessage, credentialsSubject } from '@/lib/member-credentials';
import type { ProvisionedMember } from '@/lib/team-members';

type CredentialsCardProps = {
  member: ProvisionedMember;
  teamName: string;
  teamNumber?: string | null;
  coachName?: string | null;
  onDone: () => void;
};

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one time the starter password is visible.
 *
 * Nothing stored it — not the operation receipt, not the member's profile — so
 * leaving this screen really does discard it, and the only way back to a usable
 * credential is Reset password on the roster. The card says so rather than
 * letting a coach discover it later.
 */
export function CredentialsCard({ member, teamName, teamNumber, coachName, onDone }: CredentialsCardProps) {
  const [copied, setCopied] = useState<'message' | 'password' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  if (!member.temporaryPassword) {
    // A replayed provision: the server keeps no copy either.
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
    const ok = await copy(text);
    setCopied(ok ? kind : null);
    setCopyFailed(!ok);
  }

  return (
    <section className="feature-panel credentials-card" aria-labelledby="credentials-heading">
      <span className="eyebrow">SHOWN ONCE</span>
      <h3 id="credentials-heading">{member.displayName} is on the team</h3>
      <p>
        Send them these details from your own email. This is the only time the password
        is shown — nothing here is stored, so if you lose it, issue a new one with
        <strong> Reset password</strong> on the roster.
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
