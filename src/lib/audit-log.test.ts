import { describe, expect, it } from 'vitest';
import { describeAuditEvent, parseAuditEvent, type AuditEventRow } from './audit-log';
import { memberMap, type TeamMember } from './directory';

function member(userId: string, displayName: string, role: TeamMember['role'] = 'student'): TeamMember {
  return { userId, displayName, role, status: 'active', photoURL: null, initials: displayName.slice(0, 2).toUpperCase() };
}

const lookups = {
  members: memberMap([member('coach-1', 'Coach Kim', 'coach'), member('ava', 'Ava')]),
  invitationEmails: new Map([['team-1_abc', 'new@example.com']])
};

function event(type: string, fields: Partial<AuditEventRow> = {}): AuditEventRow {
  return { id: 'e1', type, actorUserId: 'coach-1', targetUserId: null, targetResource: null, metadata: {}, createdAt: null, ...fields };
}

describe('describeAuditEvent', () => {
  it.each([
    [event('team.created'), 'Coach Kim created the team'],
    [event('invitation.created', { targetResource: 'invitations/team-1_abc', metadata: { role: 'mentor' } }), 'Coach Kim invited new@example.com as a mentor'],
    [event('invitation.created', { targetResource: 'invitations/gone', metadata: { role: 'student' } }), 'Coach Kim invited someone as a student'],
    [event('membership.changed', { targetResource: 'invitations/team-1_abc', metadata: { status: 'revoked' } }), 'Coach Kim revoked the invitation for new@example.com'],
    [event('membership.changed', { actorUserId: 'ava', targetUserId: 'ava', metadata: { role: 'student', status: 'active' } }), 'Ava joined as a student'],
    [event('membership.changed', { actorUserId: 'ava', targetUserId: 'ava', metadata: { status: 'removed' } }), 'Ava left the team'],
    [event('membership.changed', { targetUserId: 'ava', metadata: { status: 'approved' } }), "Coach Kim approved Ava's request to join"],
    [event('membership.changed', { targetUserId: 'stranger', metadata: { status: 'rejected' } }), 'Coach Kim turned down a request to join'],
    [event('membership.changed', { targetUserId: 'ava', metadata: { previousStatus: 'active', status: 'suspended' } }), 'Coach Kim suspended Ava'],
    [event('membership.changed', { targetUserId: 'ava', metadata: { previousStatus: 'suspended', status: 'active' } }), 'Coach Kim restored Ava'],
    [event('role.changed', { targetUserId: 'ava', metadata: { previousRole: 'student', role: 'parent' } }), "Coach Kim changed Ava's role from student to parent"],
    [event('role.changed', { targetUserId: 'ava', metadata: { role: 'teamLeader', action: 'transfer-leadership' } }), 'Coach Kim made Ava team leader'],
    [event('sensitive.updated', { metadata: { action: 'team.details.updated' } }), 'Coach Kim edited the team name or number'],
    [event('sensitive.updated', { metadata: { action: 'policy.updated' } }), 'Coach Kim changed the team settings'],
    [event('report.created', { actorUserId: 'ava', metadata: { reasonCode: 'unkind' } }), 'A safety report was filed (Unkind or bullying)'],
    [event('moderation.updated', { metadata: { caseStatus: 'resolved' } }), 'Coach Kim marked a safety report resolved'],
    [event('moderation.updated', { metadata: { action: 'remove-content', caseStatus: 'resolved' } }), 'Coach Kim removed a reported question'],
    [event('administrative.action', { metadata: { action: 'kanban.default-project.seeded' } }), 'Coach Kim set up the board with the standard season plan'],
    [event('administrative.action', { metadata: { action: 'file.upload.blocked' } }), 'A file upload was blocked by the safety check'],
    [event('administrative.action', { metadata: { action: 'something.new' } }), 'Coach Kim made an administrative change']
  ])('describes %o', (auditEvent, line) => {
    expect(describeAuditEvent(auditEvent, lookups)).toBe(line);
  });

  it('leaves everyday board work out', () => {
    for (const action of ['kanban.task.created', 'kanban.task.moved', 'task.updated', 'goal.created']) {
      expect(describeAuditEvent(event('administrative.action', { metadata: { action } }), lookups)).toBeNull();
    }
  });

  it('never names the person who filed a safety report', () => {
    expect(describeAuditEvent(event('report.created', { actorUserId: 'ava' }), lookups)).not.toContain('Ava');
  });

  it('names people who have left the roster as former members', () => {
    expect(describeAuditEvent(event('role.changed', { actorUserId: 'gone', targetUserId: 'ava', metadata: { previousRole: 'student', role: 'mentor' } }), lookups))
      .toBe("Former member changed Ava's role from student to mentor");
  });
});

describe('parseAuditEvent', () => {
  it('keeps known fields and defaults the rest', () => {
    expect(parseAuditEvent('e9', { type: 'team.created', actorUserId: 'coach-1', metadata: 'bad', createdAt: 5 })).toEqual({
      id: 'e9', type: 'team.created', actorUserId: 'coach-1', targetUserId: null, targetResource: null, metadata: {}, createdAt: 5
    });
  });
});
