import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEAM_POLICY,
  optionalTeamNumber,
  requireTeamName,
  requireAccountType,
  teamCreationRefusal,
  assertNotLastCoach,
  auditRecord,
  encodedInvitationId,
  isReplayOfOwnCreate,
  requireAssignableRole,
  requireEmail,
  requireMembershipStatus,
  requireResourceReference,
  requireString,
  validatePolicy,
  validateReportInput
} from '../src/phase2.js';

function snapshot(data: Record<string, unknown> | null) {
  return data === null ? { exists: false, data: () => undefined } : { exists: true, data: () => data };
}

describe('Phase 2 command validation', () => {
  it('uses explicit safe policy defaults', () => {
    expect(DEFAULT_TEAM_POLICY).toEqual({
      parentVisibility: 'none',
      directMessaging: 'disabled',
      contentAudience: 'teamOnly',
      membershipApproval: 'inviteOnly',
      fileSharing: 'disabled',
      discoverability: 'private',
      messageRetentionDays: 365
    });
  });

  it('normalizes invitation emails and never accepts a team-leader invite', () => {
    expect(requireEmail(' Student@Example.com ')).toBe('student@example.com');
    expect(encodedInvitationId('team-1', 'student@example.com')).toContain('team-1_');
    expect(requireAssignableRole('coach')).toBe('coach');
    expect(() => requireAssignableRole('teamLeader')).toThrow(/Student, Parent, Mentor, or Coach/);
  });

  it('accepts only safe policy values and bounded report references', () => {
    expect(validatePolicy({ directMessaging: 'coachesOnly', discoverability: 'private' })).toEqual({ directMessaging: 'coachesOnly', discoverability: 'private' });
    expect(() => validatePolicy({ discoverability: 'public' })).toThrow(/policy discoverability/);
    expect(validateReportInput({ targetType: 'content', targetResource: 'teams/team-1/messages/message-1', reasonCode: 'unsafe-content' })).toMatchObject({ targetType: 'content' });
    expect(() => validateReportInput({ targetType: 'user', reasonCode: 'harassment' })).toThrow(/target user/);
  });

  it('rejects a path separator so an identifier cannot escape its collection', () => {
    // Every id from requireString is interpolated into a Firestore document
    // path, so a '/' would let a caller address a different collection.
    expect(requireString(' task-1 ', 'Task ID')).toBe('task-1');
    expect(() => requireString('teams/other', 'Task ID')).toThrow(/Task ID is invalid/);
    expect(() => requireString('../memberships/team_admin', 'Task ID')).toThrow(/Task ID is invalid/);
    expect(() => requireString('a/', 'Task ID')).toThrow(/Task ID is invalid/);
    expect(() => requireString('', 'Task ID')).toThrow(/Task ID is invalid/);
    expect(() => requireString('   ', 'Task ID')).toThrow(/Task ID is invalid/);
    expect(() => requireString('x'.repeat(129), 'Task ID')).toThrow(/Task ID is invalid/);
    expect(() => requireString(42, 'Task ID')).toThrow(/Task ID is required/);
    // A dotted segment with no separator is a legal document id.
    expect(requireString('..', 'Task ID')).toBe('..');
  });

  it('bounds a resource reference to a relative, non-empty path', () => {
    expect(requireResourceReference(' messages/message-1 ')).toBe('messages/message-1');
    expect(() => requireResourceReference('/messages/message-1')).toThrow(/Resource reference is invalid/);
    expect(() => requireResourceReference('messages/')).toThrow(/Resource reference is invalid/);
    expect(() => requireResourceReference('messages//message-1')).toThrow(/Resource reference is invalid/);
    expect(() => requireResourceReference('')).toThrow(/Resource reference is invalid/);
    expect(() => requireResourceReference('x'.repeat(513))).toThrow(/Resource reference is invalid/);
    expect(() => requireResourceReference(null)).toThrow(/A resource reference is required/);
  });

  it('accepts only the membership statuses an administrator may set', () => {
    expect(requireMembershipStatus('active')).toBe('active');
    expect(requireMembershipStatus('suspended')).toBe('suspended');
    expect(requireMembershipStatus('removed')).toBe('removed');
    // 'pending' is reached through the join-request flow, never set directly.
    expect(() => requireMembershipStatus('pending')).toThrow(/Membership status is invalid/);
    expect(() => requireMembershipStatus('Active')).toThrow(/Membership status is invalid/);
    expect(() => requireMembershipStatus(undefined)).toThrow(/Membership status is invalid/);
  });

  it('allowlists audit metadata and fails as a typed error rather than a 500', () => {
    const record = auditRecord({ type: 'role.changed', actorUserId: 'coach-1', teamId: 'team-1', targetUserId: 'student-1', metadata: { role: 'coach', previousRole: 'student' } });
    expect(record).toMatchObject({ type: 'role.changed', metadata: { role: 'coach', previousRole: 'student' } });
    expect(auditRecord({ type: 'team.created', actorUserId: 'coach-1' }).metadata).toEqual({});

    // A free-form metadata key is how private student content would leak into a
    // log that coaches and platform admins can read.
    expect(() => auditRecord({ type: 'role.changed', actorUserId: 'coach-1', metadata: { messageBody: 'private' } as never }))
      .toThrow(/Audit metadata key is not allowed: messageBody/);
    expect(() => auditRecord({ type: 'role.changed', actorUserId: 'coach-1', metadata: { action: 'x'.repeat(121) } }))
      .toThrow(/Audit metadata value is too long/);
    expect(() => auditRecord({ type: 'not.a.type' as never, actorUserId: 'coach-1' })).toThrow(/Invalid audit event type/);
    expect(() => auditRecord({ type: 'role.changed', actorUserId: 'coach/1' })).toThrow(/Invalid audit actor/);
    expect(() => auditRecord({ type: 'role.changed', actorUserId: 'coach-1', teamId: 'team/1' })).toThrow(/Invalid audit target/);
    expect(() => auditRecord({ type: 'role.changed', actorUserId: 'coach-1', targetResource: '/messages/m1' })).toThrow(/Invalid audit resource/);

    // Every one of those must surface as an HttpsError; a bare Error turns the
    // caller's whole mutation into an opaque INTERNAL 500.
    try {
      auditRecord({ type: 'role.changed', actorUserId: 'coach-1', metadata: { messageBody: 'private' } as never });
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as { httpErrorCode?: { canonicalName?: string } }).httpErrorCode?.canonicalName).toBe('INTERNAL');
      expect((error as { code?: string }).code).toBe('internal');
    }
  });

  it('keeps a team covered by at least one active coach, with a suspended-coach carve-out', () => {
    // Demoting or removing the only ACTIVE coach leaves the team unsupervised.
    expect(() => assertNotLastCoach(1, 'coach', 'active', 'student', 'active')).toThrow(/at least one active coach/i);
    expect(() => assertNotLastCoach(1, 'teamLeader', 'active', 'mentor', 'active')).toThrow(/at least one active coach/i);
    expect(() => assertNotLastCoach(1, 'coach', 'active', 'coach', 'removed')).toThrow(/at least one active coach/i);
    expect(() => assertNotLastCoach(1, 'coach', 'active', 'coach', 'suspended')).toThrow(/at least one active coach/i);

    // A second active coach means coverage survives.
    expect(() => assertNotLastCoach(2, 'coach', 'active', 'student', 'active')).not.toThrow();
    // teamLeader still counts as coach coverage, so the swap is allowed.
    expect(() => assertNotLastCoach(1, 'coach', 'active', 'teamLeader', 'active')).not.toThrow();
    // The carve-out: an ALREADY suspended coach contributes no coverage, so
    // removing them must not be blocked by the last-coach rule.
    expect(() => assertNotLastCoach(1, 'coach', 'suspended', 'coach', 'removed')).not.toThrow();
    expect(() => assertNotLastCoach(0, 'coach', 'suspended', 'student', 'active')).not.toThrow();
    // A non-coach leaving never triggers the rule.
    expect(() => assertNotLastCoach(1, 'student', 'active', 'student', 'removed')).not.toThrow();
  });

  it('treats a create as a replay only when the caller owns both the record and the receipt', () => {
    const mine = { teamId: 'team-1', actorUserId: 'coach-1' };
    expect(isReplayOfOwnCreate(snapshot(null), snapshot(null), mine, 'Task')).toBe(false);
    expect(isReplayOfOwnCreate(snapshot({ teamId: 'team-1', createdBy: 'coach-1' }), snapshot(null), mine, 'Task')).toBe(true);
    expect(isReplayOfOwnCreate(snapshot(null), snapshot({ teamId: 'team-1', createdBy: 'coach-1' }), mine, 'Task')).toBe(true);

    // A bare existence check was a cross-team oracle and let one team squat an
    // id another team would later use.
    expect(() => isReplayOfOwnCreate(snapshot({ teamId: 'team-2', createdBy: 'coach-1' }), snapshot(null), mine, 'Task'))
      .toThrow(/Task ID is already used by another operation/);
    expect(() => isReplayOfOwnCreate(snapshot({ teamId: 'team-1', createdBy: 'coach-9' }), snapshot(null), mine, 'Task'))
      .toThrow(/Task ID is already used by another operation/);
    expect(() => isReplayOfOwnCreate(snapshot(null), snapshot({ teamId: 'team-2', createdBy: 'coach-1' }), mine, 'Task'))
      .toThrow(/Operation ID is already used by another operation/);
    // Community records carry teamId: null; an absent teamId must match it.
    expect(isReplayOfOwnCreate(snapshot({ createdBy: 'coach-1' }), snapshot(null), { teamId: null, actorUserId: 'coach-1' }, 'Question')).toBe(true);
  });
});

describe('requireTeamName', () => {
  it('collapses whitespace and enforces 2 to 80 characters', () => {
    expect(requireTeamName('  Tech   Summer ')).toBe('Tech Summer');
    expect(() => requireTeamName('x')).toThrow('between 2 and 80');
    expect(() => requireTeamName('x'.repeat(81))).toThrow('between 2 and 80');
    expect(() => requireTeamName(42)).toThrow('between 2 and 80');
  });
});

describe('optionalTeamNumber', () => {
  it('accepts 1 to 8 digits, as text or a whole number, and treats empty as none', () => {
    expect(optionalTeamNumber(' 12345 ')).toBe('12345');
    expect(optionalTeamNumber(678)).toBe('678');
    expect(optionalTeamNumber('')).toBeNull();
    expect(optionalTeamNumber(undefined)).toBeNull();
    expect(optionalTeamNumber(null)).toBeNull();
  });

  it('rejects anything that is not a plain team number', () => {
    expect(() => optionalTeamNumber('12a45')).toThrow('1 to 8 digits');
    expect(() => optionalTeamNumber('123456789')).toThrow('1 to 8 digits');
    expect(() => optionalTeamNumber('-5')).toThrow('1 to 8 digits');
    expect(() => optionalTeamNumber(1.5)).toThrow('digits only');
    expect(() => optionalTeamNumber({})).toThrow('digits only');
  });
});

describe('team creation by account type', () => {
  it('lets coach and mentor accounts create a team', () => {
    expect(teamCreationRefusal('coach', [])).toBeNull();
    expect(teamCreationRefusal('mentor', [{ role: 'coach', status: 'active' }, { role: 'mentor', status: 'active' }])).toBeNull();
  });

  it('refuses student and parent accounts', () => {
    expect(teamCreationRefusal('student', [])?.code).toBe('permission-denied');
    expect(teamCreationRefusal('parent', [])?.code).toBe('permission-denied');
  });

  it('asks an account with no type to choose one first', () => {
    expect(teamCreationRefusal(undefined, [])?.code).toBe('failed-precondition');
    expect(teamCreationRefusal('platformAdmin', [])?.code).toBe('failed-precondition');
  });

  it('refuses a coach-typed account that is a student or parent on some team', () => {
    expect(teamCreationRefusal('coach', [{ role: 'student', status: 'active' }])?.code).toBe('permission-denied');
    expect(teamCreationRefusal('mentor', [{ role: 'parent', status: 'pending' }])?.code).toBe('permission-denied');
    // A membership that ended no longer counts.
    expect(teamCreationRefusal('coach', [{ role: 'student', status: 'removed' }])).toBeNull();
  });

  it('validates the declared type', () => {
    expect(requireAccountType('mentor')).toBe('mentor');
    expect(() => requireAccountType('teamLeader')).toThrow('Account type must be');
    expect(() => requireAccountType(undefined)).toThrow('Account type must be');
  });
});
