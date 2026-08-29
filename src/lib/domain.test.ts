import { describe, expect, it } from 'vitest';
import {
  hasTeamRole,
  isAuthenticatedUser,
  isCoachOrLeader,
  isPlatformAdmin,
  isTeamMember,
  canRole
} from './domain';

const activeCoach = { status: 'active' as const, role: 'coach' as const };

describe('domain authorization helpers', () => {
  it('recognizes authenticated users and active memberships', () => {
    expect(isAuthenticatedUser({ uid: 'user-1' } as never)).toBe(true);
    expect(isAuthenticatedUser(null)).toBe(false);
    expect(isTeamMember(activeCoach)).toBe(true);
    expect(isTeamMember({ status: 'removed' })).toBe(false);
  });

  it('checks team roles without treating inactive records as authorized', () => {
    expect(hasTeamRole(activeCoach, ['coach'])).toBe(true);
    expect(hasTeamRole(activeCoach, ['student'])).toBe(false);
    expect(hasTeamRole({ ...activeCoach, status: 'suspended' }, ['coach'])).toBe(false);
    expect(isCoachOrLeader(activeCoach)).toBe(true);
    expect(isCoachOrLeader({ status: 'active', role: 'mentor' })).toBe(false);
  });

  it('checks the explicit platform-admin claim', () => {
    expect(isPlatformAdmin({ platformAdmin: true })).toBe(true);
    expect(isPlatformAdmin({ platformAdmin: false })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });

  it.each([
    ['student', false, true],
    ['parent', false, true],
    ['mentor', false, true],
    ['coach', true, true],
    ['teamLeader', true, true]
  ] as const)('%s has only its documented capabilities', (role, canManage, canReport) => {
    expect(canRole(role, 'membership.manage')).toBe(canManage);
    expect(canRole(role, 'report.create')).toBe(canReport);
  });

  it.each([
    ['student', 'task.updateAssignedFields', true],
    ['student', 'task.create', false],
    ['parent', 'task.updateAssignedFields', false],
    ['mentor', 'event.manage', false],
    ['coach', 'task.create', true],
    ['coach', 'goal.manage', true],
    ['teamLeader', 'file.upload', true]
  ] as const)('maps Phase 3 access for %s', (role, permission, allowed) => {
    expect(canRole(role, permission)).toBe(allowed);
  });

  it('treats Platform Admin as a separate full-access claim', () => {
    expect(canRole('platformAdmin', 'moderation.manage')).toBe(true);
    expect(canRole('student', 'moderation.manage')).toBe(false);
  });
});
