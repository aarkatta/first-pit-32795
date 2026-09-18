import { teamNumberSuffix } from './domain';

/**
 * First Pit does not send email (see CLAUDE.md: invitations are not emailed).
 * Instead these build links that open the coach's own mail — Gmail's compose
 * screen in a new tab, or any email app via `mailto:` — with the invitation
 * already written, so the message comes from someone the family knows and
 * nothing new is stored or sent by the server.
 */
export type InviteEmailInput = {
  email: string;
  link: string;
  role: string;
  teamName: string;
  teamNumber?: string | null;
  inviterName?: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  student: 'student',
  parent: 'parent',
  mentor: 'mentor',
  coach: 'coach',
  teamLeader: 'team leader'
};

export function inviteEmailSubject(input: Pick<InviteEmailInput, 'teamName' | 'teamNumber'>): string {
  return `Join ${input.teamName}${teamNumberSuffix(input.teamNumber)} on First Pit`;
}

export function inviteEmailBody(input: InviteEmailInput): string {
  const role = ROLE_LABELS[input.role] ?? 'member';
  const signature = input.inviterName?.trim();
  return [
    'Hi,',
    '',
    `You're invited to join ${input.teamName}${teamNumberSuffix(input.teamNumber)} on First Pit as a ${role}.`,
    '',
    `1. Open this link: ${input.link}`,
    `2. Sign in or create an account with this email address: ${input.email}`,
    '3. Verify your email address, then accept the invitation.',
    '',
    'The link works for 7 days, and only for this email address.',
    ...(signature ? ['', `— ${signature}`] : [])
  ].join('\n');
}

/**
 * Gmail's compose screen, in whichever Gmail account the browser is signed in
 * to. `view=cm&fs=1` is Gmail's full-screen compose; `su` is the subject.
 */
export function inviteGmailHref(input: InviteEmailInput): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: input.email, su: inviteEmailSubject(input), body: inviteEmailBody(input) });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** `encodeURIComponent` rather than URLSearchParams: mail apps read `+` literally. */
export function inviteMailtoHref(input: InviteEmailInput): string {
  const subject = encodeURIComponent(inviteEmailSubject(input));
  const body = encodeURIComponent(inviteEmailBody(input).replace(/\n/g, '\r\n'));
  return `mailto:${encodeURIComponent(input.email)}?subject=${subject}&body=${body}`;
}
