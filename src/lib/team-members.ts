import { call } from './callable';
import type { TeamRole } from './domain';
import { createOperationId } from './ids';

/** Roles a coach may provision. Team leader is a legacy title and is never provisioned. */
export type ProvisionableRole = Exclude<TeamRole, 'teamLeader'>;

/**
 * Mirrors `MIN_MEMBER_PASSWORD_LENGTH` in `functions/src/team-members.ts` — the
 * client cannot import from `functions/`, and the form needs the number to
 * write its own hint. The server re-checks every rule below; this only exists
 * so a member is not told "invalid" by a round trip.
 */
export const MIN_MEMBER_PASSWORD_LENGTH = 10;
export const MAX_MEMBER_PASSWORD_LENGTH = 64;

/**
 * What is wrong with a proposed password, in the member's own words, or null
 * when nothing is. Length beats character classes for this audience: a ten year
 * old can remember `my robot is fast` and cannot remember `R0b0t!x`.
 */
export function describePasswordProblem(value: string, email?: string | null): string | null {
  if (value.length < MIN_MEMBER_PASSWORD_LENGTH) {
    return `Use at least ${MIN_MEMBER_PASSWORD_LENGTH} characters — a few words together is perfect.`;
  }
  if (value.length > MAX_MEMBER_PASSWORD_LENGTH) return `Keep it under ${MAX_MEMBER_PASSWORD_LENGTH} characters.`;
  if (!value.trim()) return 'A password cannot be only spaces.';
  const address = (email ?? '').toLowerCase();
  const normalized = value.trim().toLowerCase();
  if (address && (normalized === address || normalized === address.split('@')[0])) {
    return 'Your password cannot be your email address.';
  }
  return null;
}

/**
 * Whether provisioning was refused because the address already has an account.
 *
 * This is not a dead end: it is the signal to offer an invitation instead, in
 * the same dialog. A coach should never have to know in advance which of the
 * two mechanisms an address needs — adding a member is always
 * Manage team → Add a member, and First Pit picks the path.
 */
export function isExistingAccountError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? String((error as { code?: unknown }).code ?? '') : '';
  return code === 'functions/already-exists' || code === 'already-exists';
}

export type ProvisionedMember = {
  userId: string;
  email: string;
  displayName: string;
  role: ProvisionableRole;
  /**
   * Shown to the coach once and stored nowhere. Null when the server replayed
   * an earlier call with the same `operationId` — it keeps no copy either, so
   * the only way back to a usable credential is a reset.
   */
  temporaryPassword: string | null;
  replayed: boolean;
};

export function provisionTeamMember(
  teamId: string,
  input: { displayName: string; email: string; role?: ProvisionableRole },
  operationId: string = createOperationId('provision')
) {
  return call<
    { teamId: string; displayName: string; email: string; role: ProvisionableRole; operationId: string },
    ProvisionedMember
  >('provisionTeamMember', { teamId, displayName: input.displayName, email: input.email, role: input.role ?? 'student', operationId });
}

export function resetTeamMemberPassword(
  teamId: string,
  userId: string,
  operationId: string = createOperationId('password-reset')
) {
  return call<
    { teamId: string; userId: string; operationId: string },
    { userId: string; temporaryPassword: string | null; replayed: boolean }
  >('resetTeamMemberPassword', { teamId, userId, operationId });
}

/** The member replaces the password their coach gave them. Server-enforced. */
export function setInitialPassword(newPassword: string) {
  return call<{ newPassword: string }, { userId: string }>('setInitialPassword', { newPassword });
}
