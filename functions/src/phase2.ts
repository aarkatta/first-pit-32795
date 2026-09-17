import { FieldValue, getFirestore, Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

export const TEAM_ROLES = ['student', 'parent', 'mentor', 'coach'] as const;
export type AssignableRole = (typeof TEAM_ROLES)[number];
export type ManagedRole = AssignableRole | 'teamLeader';
export const MEMBERSHIP_STATUSES = ['active', 'pending', 'suspended', 'removed'] as const;
export type ManagedMembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type TeamAdmin = {
  uid: string;
  platformAdmin: boolean;
  role?: ManagedRole;
};

export type PolicyInput = {
  parentVisibility?: 'none' | 'teamMembers';
  directMessaging?: 'disabled' | 'coachesOnly';
  contentAudience?: 'teamOnly';
  membershipApproval?: 'inviteOnly' | 'coachApproval';
  fileSharing?: 'disabled' | 'teamOnly';
  discoverability?: 'private';
  messageRetentionDays?: 30 | 90 | 365;
};

const AUDIT_METADATA_KEYS = new Set(['role', 'previousRole', 'status', 'previousStatus', 'action', 'reasonCode', 'caseStatus', 'severity']);

export const DEFAULT_TEAM_POLICY = {
  parentVisibility: 'none',
  directMessaging: 'disabled',
  contentAudience: 'teamOnly',
  membershipApproval: 'inviteOnly',
  fileSharing: 'disabled',
  discoverability: 'private',
  messageRetentionDays: 365
} as const;

function inputRecord(request: CallableRequest<unknown>): Record<string, unknown> {
  return request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
}

export function requireString(value: unknown, label: string, maxLength = 128): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || trimmed.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
  return trimmed;
}

/**
 * Free text a person writes: a task title, a description, a comment.
 *
 * `requireString` refuses "/" because it guards identifiers that end up in
 * document paths. Applying that to prose was over-reach — "passive/active
 * attachments" and "Robot Design / Build" are ordinary things for a coach to
 * type, and the standard task template itself contains three of them. Control
 * characters are still rejected, since nothing legitimate carries them and they
 * corrupt exports and logs.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function requireText(value: unknown, label: string, maxLength = 4000): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || CONTROL_CHARACTERS.test(trimmed)) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
  return trimmed;
}

export function requireEmail(value: unknown): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'A valid email address is required.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }
  return email;
}

export function requireResourceReference(value: unknown): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'A resource reference is required.');
  const reference = value.trim();
  if (!reference || reference.length > 512 || reference.startsWith('/') || reference.endsWith('/') || reference.includes('//')) {
    throw new HttpsError('invalid-argument', 'Resource reference is invalid.');
  }
  return reference;
}

export function requireAuth(request: CallableRequest<unknown>): { uid: string; platformAdmin: boolean } {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication is required.');
  return { uid: request.auth.uid, platformAdmin: request.auth.token.platformAdmin === true };
}

export function getInput(request: CallableRequest<unknown>, key: string): unknown {
  return inputRecord(request)[key];
}

export function encodedInvitationId(teamId: string, email: string): string {
  return `${teamId}_${Buffer.from(email.toLowerCase()).toString('base64url')}`;
}

function isManagedRole(value: unknown): value is ManagedRole {
  return value === 'student' || value === 'parent' || value === 'mentor' || value === 'coach' || value === 'teamLeader';
}

export function requireAssignableRole(value: unknown): AssignableRole {
  if (!isManagedRole(value) || value === 'teamLeader') {
    throw new HttpsError('invalid-argument', 'Role must be Student, Parent, Mentor, or Coach.');
  }
  return value;
}

export function requireMembershipStatus(value: unknown): ManagedMembershipStatus {
  if (value !== 'active' && value !== 'suspended' && value !== 'removed') {
    throw new HttpsError('invalid-argument', 'Membership status is invalid.');
  }
  return value;
}

export function requireTeamId(request: CallableRequest<unknown>): string {
  return requireString(getInput(request, 'teamId'), 'Team ID');
}

export function validatePolicy(input: Record<string, unknown>): PolicyInput {
  const policy: PolicyInput = {};
  const values = [
    ['parentVisibility', ['none', 'teamMembers']],
    ['directMessaging', ['disabled', 'coachesOnly']],
    ['contentAudience', ['teamOnly']],
    ['membershipApproval', ['inviteOnly', 'coachApproval']],
    ['fileSharing', ['disabled', 'teamOnly']],
    ['discoverability', ['private']]
  ] as const;
  for (const [key, allowed] of values) {
    const value = input[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !allowed.includes(value as never)) {
        throw new HttpsError('invalid-argument', `Team policy ${key} is invalid.`);
      }
      (policy as Record<string, string>)[key] = value;
    }
  }
  if (input.messageRetentionDays !== undefined) {
    const retention = input.messageRetentionDays;
    if (retention !== 30 && retention !== 90 && retention !== 365) {
      throw new HttpsError('invalid-argument', 'Message retention must be 30, 90, or 365 days.');
    }
    policy.messageRetentionDays = retention;
  }
  return policy;
}

export function validateReportInput(input: Record<string, unknown>) {
  const targetType = input.targetType;
  if (targetType !== 'user' && targetType !== 'content') {
    throw new HttpsError('invalid-argument', 'Report target type is invalid.');
  }
  const reasonCode = requireString(input.reasonCode, 'Report reason', 64);
  const description = input.description === undefined ? undefined : requireString(input.description, 'Report description', 2000);
  const targetUserId = input.targetUserId === undefined ? undefined : requireString(input.targetUserId, 'Target user ID');
  const targetResource = input.targetResource === undefined ? undefined : requireResourceReference(input.targetResource);
  if (targetType === 'user' && !targetUserId) throw new HttpsError('invalid-argument', 'A user report needs a target user.');
  if (targetType === 'content' && !targetResource) throw new HttpsError('invalid-argument', 'A content report needs an evidence reference.');
  return { targetType, reasonCode, description, targetUserId, targetResource } as const;
}

export async function getMembership(teamId: string, uid: string): Promise<DocumentData | null> {
  const snapshot = await getFirestore().doc(`memberships/${teamId}_${uid}`).get();
  return snapshot.exists ? snapshot.data() ?? null : null;
}

export async function requireTeamAdmin(request: CallableRequest<unknown>, teamId: string): Promise<TeamAdmin> {
  const auth = requireAuth(request);
  if (auth.platformAdmin) return auth;
  const membership = await getMembership(teamId, auth.uid);
  if (!membership || membership.teamId !== teamId || membership.userId !== auth.uid || membership.status !== 'active' || !['coach', 'teamLeader'].includes(membership.role)) {
    throw new HttpsError('permission-denied', 'Only an active coach or team leader can administer this team.');
  }
  return { ...auth, role: membership.role as ManagedRole };
}

export async function requireTeamMember(request: CallableRequest<unknown>, teamId: string): Promise<TeamAdmin> {
  const auth = requireAuth(request);
  if (auth.platformAdmin) return auth;
  const membership = await getMembership(teamId, auth.uid);
  if (!membership || membership.teamId !== teamId || membership.userId !== auth.uid || membership.status !== 'active') {
    throw new HttpsError('permission-denied', 'An active team membership is required.');
  }
  return { ...auth, role: membership.role as ManagedRole };
}

export async function assertTeamAdminInTransaction(transaction: Transaction, teamId: string, admin: TeamAdmin) {
  if (admin.platformAdmin) return;
  const snapshot = await transaction.get(getFirestore().doc(`memberships/${teamId}_${admin.uid}`));
  const data = snapshot.data();
  if (!snapshot.exists || data?.teamId !== teamId || data.userId !== admin.uid || data.status !== 'active' || !['coach', 'teamLeader'].includes(data.role)) {
    throw new HttpsError('permission-denied', 'Your team-admin access changed. Refresh and try again.');
  }
}

export async function assertTeamMemberInTransaction(transaction: Transaction, teamId: string, uid: string) {
  const snapshot = await transaction.get(getFirestore().doc(`memberships/${teamId}_${uid}`));
  const data = snapshot.data();
  if (!snapshot.exists || data?.teamId !== teamId || data.userId !== uid || data.status !== 'active') {
    throw new HttpsError('permission-denied', 'An active team membership is required.');
  }
  return data;
}

export type AuditEventType =
  | 'team.created'
  | 'invitation.created'
  | 'role.changed'
  | 'membership.changed'
  | 'administrative.action'
  | 'sensitive.updated'
  | 'report.created'
  | 'moderation.updated';

const AUDIT_EVENT_TYPES = new Set<AuditEventType>([
  'team.created',
  'invitation.created',
  'role.changed',
  'membership.changed',
  'administrative.action',
  'sensitive.updated',
  'report.created',
  'moderation.updated'
]);

export type AuditEventInput = {
  type: AuditEventType;
  actorUserId: string;
  teamId?: string;
  targetUserId?: string;
  targetResource?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !value.includes('/');
}

function validResourcePath(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !value.startsWith('/') && !value.endsWith('/') && !value.includes('//');
}

/**
 * The single audit-record builder. Audit events are immutable and are what
 * moderation reads back, so every field is validated here rather than at the
 * ~17 call sites.
 */
export function auditRecord(input: AuditEventInput) {
  // A rejected audit field is a server-side programming error, not a caller
  // mistake — but it aborts the caller's whole mutation, so it must arrive as a
  // typed HttpsError instead of the opaque INTERNAL [500] a bare Error produces.
  if (!AUDIT_EVENT_TYPES.has(input.type)) throw new HttpsError('internal', 'Invalid audit event type.');
  if (!validIdentifier(input.actorUserId)) throw new HttpsError('internal', 'Invalid audit actor.');
  for (const value of [input.teamId, input.targetUserId]) {
    if (value !== undefined && !validIdentifier(value)) throw new HttpsError('internal', 'Invalid audit target.');
  }
  if (input.targetResource !== undefined && !validResourcePath(input.targetResource)) throw new HttpsError('internal', 'Invalid audit resource.');

  const metadata = input.metadata ?? {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!AUDIT_METADATA_KEYS.has(key)) throw new HttpsError('internal', `Audit metadata key is not allowed: ${key}`);
    if (typeof value === 'string' && value.length > 120) throw new HttpsError('internal', 'Audit metadata value is too long.');
  }

  return { ...input, metadata, createdAt: FieldValue.serverTimestamp() };
}

export function assertNotLastCoach(count: number, currentRole: string, currentStatus: string, nextRole: string, nextStatus: string) {
  // Only a currently ACTIVE coach counts toward coverage; removing an already
  // suspended coach must not be blocked by the last-coach rule.
  const losesCoachAccess = currentStatus === 'active' && ['coach', 'teamLeader'].includes(currentRole) && (!['coach', 'teamLeader'].includes(nextRole) || nextStatus !== 'active');
  if (losesCoachAccess && count <= 1) {
    throw new HttpsError('failed-precondition', 'A team must keep at least one active coach. Transfer leadership before leaving or changing this role.');
  }
}

type ReplaySnapshot = { exists: boolean; data: () => DocumentData | undefined } | null;

/**
 * Replay guard for idempotent creates.
 *
 * A bare `if (existing.exists) return;` is a cross-team existence oracle: any
 * member can probe whether an ID is taken in another team, and can squat an ID
 * a different team will later use. Both the target document and the operation
 * receipt must belong to this team AND this actor before a create is treated as
 * a replay of the caller's own work.
 *
 * Returns true when the caller may return the already-committed result.
 */
export function isReplayOfOwnCreate(
  existing: ReplaySnapshot,
  operation: ReplaySnapshot,
  expected: { teamId: string | null; actorUserId: string },
  label: string
): boolean {
  for (const [snapshot, kind] of [[operation, 'Operation'], [existing, label]] as const) {
    if (!snapshot?.exists) continue;
    const data = snapshot.data() ?? {};
    if ((data.teamId ?? null) !== (expected.teamId ?? null) || data.createdBy !== expected.actorUserId) {
      throw new HttpsError('already-exists', `${kind} ID is already used by another operation.`);
    }
    return true;
  }
  return false;
}

export function expiryTimestamp(days = 7) {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}
