import { teamNumberSuffix } from './domain';
import { publicWebOrigin } from './public-origin';

/**
 * The message a coach sends a new member with their starter password.
 *
 * Built for the clipboard, never for a URL. `invite-email.ts` can hand Gmail a
 * pre-written compose screen because an invitation link is safe to put in a
 * query string; a live password is not — it would land in the coach's browser
 * history, and in whatever syncs it. So this returns text the coach pastes into
 * their own mail client, which also means it works with Outlook and Apple Mail
 * rather than Gmail alone.
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
