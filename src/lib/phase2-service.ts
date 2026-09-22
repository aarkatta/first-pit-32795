import type { InvitationStatus, TeamPolicy, TeamRole } from './domain';
import { call } from './callable';
import { createOperationId } from './ids';

type TeamAdminRole = Exclude<TeamRole, 'teamLeader'>;

/**
 * Invitations, role changes, membership status changes, and leadership transfers
 * each write an immutable `auditEvents` record. Without an idempotency key a
 * retried call (a flaky network, a double-submitted form) appends a second audit
 * event for one administrative intent and corrupts the moderation trail, so every
 * one of them carries an `operationId`. Callers that can retry the *same* intent
 * should generate the id once with `createOperationId()` and pass it back in;
 * the default value covers the common one-shot case.
 */
export function createInvitation(
  teamId: string,
  email: string,
  role: TeamAdminRole = 'student',
  operationId: string = createOperationId('invitation')
) {
  return call<{ teamId: string; email: string; role: TeamAdminRole; operationId: string }, { invitationId: string }>(
    'createInvitation',
    { teamId, email, role, operationId }
  );
}

export function revokeInvitation(teamId: string, invitationId: string) {
  return call<{ teamId: string; invitationId: string }, { invitationId: string; status: InvitationStatus }>('revokeInvitation', { teamId, invitationId });
}

export function acceptInvitation(invitationId: string) {
  return call<{ invitationId: string }, { teamId: string }>('acceptInvitation', { invitationId });
}

export function requestToJoinTeam(teamId: string) {
  return call<{ teamId: string }, { requestId: string }>('requestToJoinTeam', { teamId });
}

export function approveJoinRequest(teamId: string, requestId: string) {
  return call<{ teamId: string; requestId: string }, { requestId: string; status: 'approved' }>('approveJoinRequest', { teamId, requestId });
}

export function rejectJoinRequest(teamId: string, requestId: string) {
  return call<{ teamId: string; requestId: string }, { requestId: string; status: 'rejected' }>('rejectJoinRequest', { teamId, requestId });
}

export function assignTeamRole(
  teamId: string,
  userId: string,
  role: TeamAdminRole,
  operationId: string = createOperationId('role')
) {
  return call<
    { teamId: string; userId: string; role: TeamAdminRole; operationId: string },
    { teamId: string; userId: string; role: TeamAdminRole }
  >('assignTeamRole', { teamId, userId, role, operationId });
}

export function updateMembershipStatus(
  teamId: string,
  userId: string,
  status: 'active' | 'suspended' | 'removed',
  operationId: string = createOperationId('membership')
) {
  return call<
    { teamId: string; userId: string; status: 'active' | 'suspended' | 'removed'; operationId: string },
    { teamId: string; userId: string; status: 'active' | 'suspended' | 'removed' }
  >('updateMembershipStatus', { teamId, userId, status, operationId });
}

export function leaveTeam(teamId: string) {
  return call<{ teamId: string }, { teamId: string; status: 'removed' }>('leaveTeam', { teamId });
}

export function transferTeamLeadership(
  teamId: string,
  targetUserId: string,
  operationId: string = createOperationId('leadership')
) {
  return call<
    { teamId: string; targetUserId: string; operationId: string },
    { teamId: string; targetUserId: string; role: 'teamLeader' }
  >('transferTeamLeadership', { teamId, targetUserId, operationId });
}

export type TeamPolicyUpdate = Partial<Omit<TeamPolicy, 'teamId' | 'updatedAt'>>;

export function updateTeamPolicy(teamId: string, policy: TeamPolicyUpdate) {
  return call<{ teamId: string } & TeamPolicyUpdate, { teamId: string } & TeamPolicyUpdate>('updateTeamPolicy', { teamId, ...policy });
}

export function createReport(input: {
  teamId: string;
  targetType: 'user' | 'content';
  targetUserId?: string;
  targetResource?: string;
  reasonCode: string;
  description?: string;
}) {
  return call<typeof input, { reportId: string; moderationCaseId: string }>('createReport', input);
}

/**
 * A moderation case is the most safety-sensitive record in the product, so the
 * server refuses a blind write: `expectedVersion` must match the stored
 * `version` or the call fails with `aborted` rather than letting one coach
 * silently overwrite another's triage. Documents created before the field
 * existed count as version 1.
 */
export function updateModerationCase(input: {
  teamId: string;
  caseId: string;
  expectedVersion: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  status?: 'open' | 'investigating' | 'resolved' | 'dismissed';
  assignedTo?: string | null;
  action?: 'none' | 'warning' | 'remove-content' | 'suspend-member' | 'remove-member' | 'escalate';
  escalated?: boolean;
}) {
  return call<typeof input, Omit<typeof input, 'teamId'> & { version: number }>('updateModerationCase', input);
}
