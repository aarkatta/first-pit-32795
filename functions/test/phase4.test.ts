import { describe, expect, it } from 'vitest';
import { canAccessChannel, messageRetentionDays, parentsCanReadTeamContent, retentionCutoff, MESSAGE_PURGE_PAGE_SIZE } from '../src/phase4.js';
import { DEFAULT_TEAM_POLICY } from '../src/phase2.js';

type Role = 'coach' | 'teamLeader' | 'student' | 'mentor' | 'parent';

function member(role: Role, uid = `${role}-1`) {
  return { uid, role, platformAdmin: false } as const;
}

describe('Phase 4 channel access', () => {
  const policy = { directMessaging: 'coachesOnly' };
  const coach = member('coach');
  const otherCoach = member('coach', 'coach-3');

  it('keeps direct-channel access participant-bound for administrators', () => {
    const direct = { visibility: 'direct', participantUserIds: ['coach-1', 'coach-2'] };
    expect(canAccessChannel(coach, direct, policy)).toBe(true);
    expect(canAccessChannel(otherCoach, direct, policy)).toBe(false);
    expect(canAccessChannel(coach, direct, { directMessaging: 'disabled' })).toBe(false);
  });

  it('preserves team and coaches channel access for coaches', () => {
    expect(canAccessChannel(coach, { visibility: 'team' }, policy)).toBe(true);
    expect(canAccessChannel(coach, { visibility: 'coaches' }, policy)).toBe(true);
    expect(canAccessChannel(member('student'), { visibility: 'coaches' }, policy)).toBe(false);
  });
});

describe('Phase 4 parent visibility policy', () => {
  const roles: Role[] = ['coach', 'teamLeader', 'student', 'mentor', 'parent'];
  const closed = { ...DEFAULT_TEAM_POLICY };
  const open = { ...DEFAULT_TEAM_POLICY, parentVisibility: 'teamMembers' };

  it('denies by default and opens only on an explicit teamMembers opt-in', () => {
    // `parentVisibility: 'none'` is the shipped default; anything unrecognized,
    // missing, or malformed must be treated as "none" rather than "allow".
    expect(parentsCanReadTeamContent(closed)).toBe(false);
    expect(parentsCanReadTeamContent({})).toBe(false);
    expect(parentsCanReadTeamContent({ parentVisibility: undefined })).toBe(false);
    expect(parentsCanReadTeamContent({ parentVisibility: 'everyone' })).toBe(false);
    expect(parentsCanReadTeamContent({ parentVisibility: true })).toBe(false);
    expect(parentsCanReadTeamContent(open)).toBe(true);
  });

  it('gates team-channel access by role against the closed default policy', () => {
    const teamChannel = { visibility: 'team' };
    const allowed = Object.fromEntries(roles.map((role) => [role, canAccessChannel(member(role), teamChannel, closed)]));
    expect(allowed).toEqual({
      coach: true,
      teamLeader: true,
      student: true,
      mentor: true,
      // The product promises parents do not read the team conversation unless
      // the team opts in; this is the case that used to return true for everyone.
      parent: false
    });
  });

  it('lets parents into the team channel once the team opts in', () => {
    const teamChannel = { visibility: 'team' };
    const allowed = Object.fromEntries(roles.map((role) => [role, canAccessChannel(member(role), teamChannel, open)]));
    expect(allowed).toEqual({ coach: true, teamLeader: true, student: true, mentor: true, parent: true });
  });

  it('never lets a parent into coach or direct channels, whatever the visibility policy', () => {
    for (const policy of [closed, open, { ...open, directMessaging: 'coachesOnly' }]) {
      expect(canAccessChannel(member('parent'), { visibility: 'coaches' }, policy)).toBe(false);
      expect(canAccessChannel(member('parent'), { visibility: 'direct', participantUserIds: ['parent-1', 'coach-1'] }, policy)).toBe(false);
    }
  });

  it('refuses an unknown channel visibility for every role', () => {
    for (const role of roles) {
      expect(canAccessChannel(member(role), { visibility: 'public' }, open)).toBe(false);
      expect(canAccessChannel(member(role), {}, open)).toBe(false);
    }
  });

  it('treats a platform admin as an operator rather than a team parent', () => {
    const platformAdmin = { uid: 'admin-1', platformAdmin: true } as const;
    expect(canAccessChannel(platformAdmin, { visibility: 'team' }, closed)).toBe(true);
    expect(canAccessChannel(platformAdmin, { visibility: 'coaches' }, closed)).toBe(true);
  });
});

describe('Phase 4 message retention', () => {
  it('falls back to the longest window rather than deleting more than the policy allows', () => {
    expect(messageRetentionDays(30)).toBe(30);
    expect(messageRetentionDays(90)).toBe(90);
    expect(messageRetentionDays(365)).toBe(365);
    // A missing, malformed, or out-of-range setting must never shorten the
    // window — that would destroy history the team never agreed to lose.
    expect(messageRetentionDays(undefined)).toBe(365);
    expect(messageRetentionDays(null)).toBe(365);
    expect(messageRetentionDays(0)).toBe(365);
    expect(messageRetentionDays(1)).toBe(365);
    expect(messageRetentionDays('30')).toBe(365);
    expect(messageRetentionDays(-90)).toBe(365);
  });

  it('computes the retention cutoff as exactly N days before now', () => {
    const now = Date.parse('2026-08-29T00:00:00.000Z');
    expect(retentionCutoff(30, now).toDate().toISOString()).toBe('2026-07-30T00:00:00.000Z');
    expect(retentionCutoff(365, now).toDate().toISOString()).toBe('2025-08-29T00:00:00.000Z');
    // The cutoff is in the past, so nothing newer than the window is selected.
    expect(retentionCutoff(30, now).toMillis()).toBeLessThan(now);
  });

  it('purges one bounded page at a time so a long backlog cannot exceed a transaction', () => {
    expect(MESSAGE_PURGE_PAGE_SIZE).toBe(100);
  });
});
