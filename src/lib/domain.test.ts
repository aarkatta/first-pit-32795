import { describe, expect, it } from 'vitest';
import {
  canBeAssignedTasks,
  teamNumberSuffix,
  nameInitials,
  roleLabel,
  canEditKnowledge,
  canEditTasks,
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
    ['student', 'task.create', true],
    ['mentor', 'task.create', false],
    ['parent', 'task.create', false],
    ['parent', 'task.updateAssignedFields', false],
    ['mentor', 'event.manage', false],
    ['coach', 'task.create', true],
    ['coach', 'goal.manage', true],
    ['teamLeader', 'file.upload', true]
  ] as const)('maps Phase 3 access for %s', (role, permission, allowed) => {
    expect(canRole(role, permission)).toBe(allowed);
  });

  it('lets coaches, team leaders and students edit tracker tasks, and no one else', () => {
    expect(canEditTasks({ role: 'coach', status: 'active' })).toBe(true);
    expect(canEditTasks({ role: 'teamLeader', status: 'active' })).toBe(true);
    expect(canEditTasks({ role: 'student', status: 'active' })).toBe(true);
    expect(canEditTasks({ role: 'student', status: 'suspended' })).toBe(false);
    expect(canEditTasks({ role: 'mentor', status: 'active' })).toBe(false);
    expect(canEditTasks({ role: 'parent', status: 'active' })).toBe(false);
    expect(canEditTasks(null)).toBe(false);
  });

  it('lets coaches, team leaders, mentors and students manage Knowledge, and not parents', () => {
    for (const role of ['coach', 'teamLeader', 'mentor', 'student'] as const) expect(canEditKnowledge({ role, status: 'active' })).toBe(true);
    expect(canEditKnowledge({ role: 'mentor', status: 'suspended' })).toBe(false);
    expect(canEditKnowledge({ role: 'parent', status: 'active' })).toBe(false);
    expect(canEditKnowledge(null)).toBe(false);
  });

  it('formats the team number that follows a team name', () => {
    expect(teamNumberSuffix('12345')).toBe(' · Team #12345');
    expect(teamNumberSuffix(null)).toBe('');
    expect(teamNumberSuffix(undefined)).toBe('');
  });

  it('treats Platform Admin as a separate full-access claim', () => {
    expect(canRole('platformAdmin', 'moderation.manage')).toBe(true);
    expect(canRole('student', 'moderation.manage')).toBe(false);
  });
});

describe('canBeAssignedTasks', () => {
  it('lets every role but parents be given tracker work', () => {
    for (const role of ['coach', 'teamLeader', 'mentor', 'student']) expect(canBeAssignedTasks(role)).toBe(true);
    expect(canBeAssignedTasks('parent')).toBe(false);
    expect(canBeAssignedTasks(null)).toBe(false);
  });
});

describe('display helpers', () => {
  it('labels roles for people, with a readable fallback', () => {
    expect(roleLabel('coach')).toBe('Coach');
    expect(roleLabel('teamLeader')).toBe('Team leader');
    expect(roleLabel(undefined)).toBe('Member');
    expect(roleLabel('')).toBe('Member');
  });

  it('takes up to two initials from a name', () => {
    expect(nameInitials('Tech Titans NC')).toBe('TT');
    expect(nameInitials('  robotics  ')).toBe('R');
    expect(nameInitials('', 'FP')).toBe('FP');
    expect(nameInitials(null, 'T')).toBe('T');
  });
});
