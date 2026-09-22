import { describe, expect, it, vi } from 'vitest';

const call = vi.hoisted(() => vi.fn());
vi.mock('./callable', () => ({ call }));

import {
  describePasswordProblem,
  isExistingAccountError,
  MAX_MEMBER_PASSWORD_LENGTH,
  MIN_MEMBER_PASSWORD_LENGTH,
  provisionTeamMember,
  resetTeamMemberPassword,
  setInitialPassword
} from './team-members';

describe('describePasswordProblem', () => {
  it('accepts a passphrase a child can remember', () => {
    expect(describePasswordProblem('my robot is fast', 'ada@example.com')).toBeNull();
  });

  it('asks for length rather than symbols', () => {
    expect(describePasswordProblem('short')).toMatch(new RegExp(`${MIN_MEMBER_PASSWORD_LENGTH} characters`));
    expect(describePasswordProblem('x'.repeat(MAX_MEMBER_PASSWORD_LENGTH + 1))).toMatch(/under/);
    expect(describePasswordProblem('          ')).toMatch(/only spaces/);
  });

  it('refuses the member\'s own address and its local part', () => {
    expect(describePasswordProblem('ada@example.com', 'ada@example.com')).toMatch(/email address/);
    expect(describePasswordProblem('Ada@Example.com', 'ada@example.com')).toMatch(/email address/);
    expect(describePasswordProblem('adaadaada', 'ada@example.com')).toMatch(/characters/);
    // Only compared when an address is known.
    expect(describePasswordProblem('ada@example.com')).toBeNull();
  });
});

describe('provisioning callables', () => {
  it('defaults to the student role and generates an operation id', () => {
    call.mockResolvedValue({});
    void provisionTeamMember('team-1', { displayName: 'Ada Lovelace', email: 'ada@example.com' });
    const [name, input] = call.mock.calls[0];
    expect(name).toBe('provisionTeamMember');
    expect(input).toMatchObject({ teamId: 'team-1', displayName: 'Ada Lovelace', email: 'ada@example.com', role: 'student' });
    expect(String(input.operationId)).toContain('provision');
  });

  it('passes an explicit operation id through, so a retry replays instead of re-minting', () => {
    call.mockResolvedValue({});
    void provisionTeamMember('team-1', { displayName: 'Ada', email: 'ada@example.com', role: 'mentor' }, 'op-1');
    expect(call).toHaveBeenLastCalledWith('provisionTeamMember', expect.objectContaining({ role: 'mentor', operationId: 'op-1' }));
    void resetTeamMemberPassword('team-1', 'member-1', 'op-2');
    expect(call).toHaveBeenLastCalledWith('resetTeamMemberPassword', { teamId: 'team-1', userId: 'member-1', operationId: 'op-2' });
  });

  it('sends only the new password when a member sets their own', () => {
    call.mockResolvedValue({ userId: 'member-1' });
    void setInitialPassword('my robot is fast');
    expect(call).toHaveBeenLastCalledWith('setInitialPassword', { newPassword: 'my robot is fast' });
  });
});

describe('isExistingAccountError', () => {
  it('recognises the already-exists refusal, and nothing else', () => {
    expect(isExistingAccountError({ code: 'functions/already-exists' })).toBe(true);
    expect(isExistingAccountError({ code: 'already-exists' })).toBe(true);
    expect(isExistingAccountError({ code: 'functions/permission-denied' })).toBe(false);
    expect(isExistingAccountError(new Error('already-exists'))).toBe(false);
    expect(isExistingAccountError(null)).toBe(false);
  });
});
