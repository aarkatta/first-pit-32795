import { teamNumberSuffix } from './domain';
import { publicWebOrigin } from './public-origin';

/**
 * The message a coach sends a new member with their starter password.
 *
 * `credentialsMessage` is the text a coach copies and pastes into any mail
 * client (Outlook and Apple Mail, not Gmail alone). `credentialsGmailHref`
 * additionally hands Gmail a pre-written compose screen, matching the
 * invitation flow's convenience for the common case of a coach on Gmail.
 *
 * Note that the Gmail link carries the starter password in the URL query
 * string, so it lands in the coach's browser history and in whatever syncs it.
 * That is an accepted trade-off (the password is temporary and the forced
 * change invalidates it on first sign-in); the copy-and-paste path stays for
 * coaches who would rather not put it in a URL.
 */
export type MemberCredentialsInput = {
  displayName: string;
  email: string;
  temporaryPassword: string;
  teamName: string;
  teamNumber?: string | null;
  coachName?: string | null;
};

export function credentialsSubject(input: Pick<MemberCredentialsInput, 'teamName' | 'teamNumber'>): string {
  return `Your First Pit account for ${input.teamName}${teamNumberSuffix(input.teamNumber)}`;
}

export function credentialsMessage(input: MemberCredentialsInput): string {
  const firstName = input.displayName.trim().split(/\s+/)[0] || 'there';
  const signature = input.coachName?.trim();
  return [
    `Hi ${firstName},`,
    '',
    `Your First Pit account for ${input.teamName}${teamNumberSuffix(input.teamNumber)} is ready.`,
    '',
    `1. Open ${publicWebOrigin()}`,
    `2. Sign in with this email: ${input.email}`,
    `3. Starter password: ${input.temporaryPassword}`,
    '',
    'First Pit will ask you to choose your own password straight away. The starter password stops working once you do, so you do not need to keep this message.',
    ...(signature ? ['', `— ${signature}`] : [])
  ].join('\n');
}

/**
 * Gmail's compose screen, in whichever Gmail account the browser is signed in
 * to. `view=cm&fs=1` is Gmail's full-screen compose; `su` is the subject.
 * Mirrors `inviteGmailHref` in `invite-email.ts`.
 */
export function credentialsGmailHref(input: MemberCredentialsInput): string {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: input.email,
    su: credentialsSubject(input),
    body: credentialsMessage(input)
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
