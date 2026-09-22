import { call } from './callable';
import type { TeamRole } from './domain';

/**
 * Team roster with display names.
 *
 * `users/{uid}` is readable only by its owner, which is the right default for a
 * product used by minors. The consequence is that the client cannot turn a
 * membership's `userId` into a name on its own, so every screen that shows a
 * person — the roster, task assignees, score participants — would
 * otherwise render a raw Firebase UID. The `listTeamMembers` callable does the
 * join with the Admin SDK and returns only what a teammate may see.
 */
export type TeamMember = {
  userId: string;
  role: TeamRole;
  status: string;
  displayName: string;
  photoURL: string | null;
  initials: string;
  /**
   * Whether this team created the account, so a coach may reset its password.
   * Sent only to coaches and team leaders — undefined for everyone else, which
   * is why the roster reads it with `=== true` rather than trusting a default.
   */
  provisionedByThisTeam?: boolean;
  /** Admin-only: still signing in with the password their coach passed on. */
  mustSetPassword?: boolean;
};

export type TeamRoster = {
  members: TeamMember[];
  truncated: boolean;
};

export function listTeamMembers(teamId: string) {
  return call<{ teamId: string }, TeamRoster>('listTeamMembers', { teamId });
}

/**
 * Lookup keyed by user id. Screens render `nameOf(map, userId)` so an unknown or
 * removed member degrades to a readable label instead of a UID.
 */
export function memberMap(members: TeamMember[]): Map<string, TeamMember> {
  return new Map(members.map((member) => [member.userId, member]));
}

export function nameOf(members: Map<string, TeamMember>, userId: string | null | undefined): string {
  if (!userId) return 'Unassigned';
  return members.get(userId)?.displayName ?? 'Former member';
}

export function initialsOf(members: Map<string, TeamMember>, userId: string | null | undefined): string {
  if (!userId) return '—';
  return members.get(userId)?.initials ?? '??';
}
