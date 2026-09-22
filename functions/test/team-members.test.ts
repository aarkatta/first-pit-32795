import { describe, expect, it } from 'vitest';
import {
  accountTypeForRole,
  assertProvisionedByTeam,
  generateTemporaryPassword,
  MAX_MEMBER_PASSWORD_LENGTH,
  MIN_MEMBER_PASSWORD_LENGTH,
  PASSWORD_WORDS,
  requireNewPassword,
  requirePersonName,
  requireProvisionableRole,
  temporaryPasswordEntropyBits
} from '../src/team-members.js';

describe('temporary password generation', () => {
  it('builds a readable Word-Word-Word-1234 credential', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-Z][a-z]{3,5}-[A-Z][a-z]{3,5}-[A-Z][a-z]{3,5}-\d{4}$/);
      // Repeated words read as a transcription slip to whoever copies this down.
      const words = password.split('-').slice(0, 3);
      expect(new Set(words).size).toBe(3);
    }
  });

  it('keeps the word list unambiguous and typable', () => {
    expect(PASSWORD_WORDS.length).toBeGreaterThanOrEqual(64);
    expect(new Set(PASSWORD_WORDS).size).toBe(PASSWORD_WORDS.length);
    for (const word of PASSWORD_WORDS) {
      expect(word).toMatch(/^[a-z]{4,6}$/);
    }
  });

  it('keeps the search space above 32 bits', () => {
    // The floor that justifies handing this to a coach to read out: see the
    // comment on temporaryPasswordEntropyBits for why 33 bits is enough here
    // and would not be for a stored credential.
    expect(temporaryPasswordEntropyBits()).toBeGreaterThan(32);
  });

  it('does not repeat itself', () => {
    const generated = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(generated.size).toBe(500);
  });
});

describe('member-chosen passwords', () => {
  it('accepts a long passphrase a child can remember', () => {
    expect(requireNewPassword('my robot is fast')).toBe('my robot is fast');
  });

  it('never trims, so a password stays typable back', () => {
    const padded = ` ${'spaced out pass'} `;
    expect(requireNewPassword(padded)).toBe(padded);
  });

  it('refuses short, oversized, empty, and control-character passwords', () => {
    expect(() => requireNewPassword('short')).toThrow(new RegExp(`${MIN_MEMBER_PASSWORD_LENGTH} and ${MAX_MEMBER_PASSWORD_LENGTH}`));
    expect(() => requireNewPassword('x'.repeat(MAX_MEMBER_PASSWORD_LENGTH + 1))).toThrow(/characters/);
    expect(() => requireNewPassword('          ')).toThrow(/not allowed/);
    expect(() => requireNewPassword('good password\u0007')).toThrow(/not allowed/);
    expect(() => requireNewPassword(12345678901)).toThrow(/required/);
  });

  it('refuses obvious passwords whatever their case', () => {
    expect(() => requireNewPassword('Password123')).toThrow(/too easy to guess/);
    expect(() => requireNewPassword('FirstLegoLeague')).toThrow(/too easy to guess/);
  });
});

describe('provisioning inputs', () => {
  it('collapses whitespace in a name and keeps non-Latin scripts', () => {
    expect(requirePersonName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(requirePersonName('Zoë Müller')).toBe('Zoë Müller');
    expect(requirePersonName('宮本 茂')).toBe('宮本 茂');
  });

  it('refuses a name that is too short, too long, or has no letters', () => {
    expect(() => requirePersonName('A')).toThrow(/full name/);
    expect(() => requirePersonName('x'.repeat(81))).toThrow(/full name/);
    expect(() => requirePersonName('--- ...')).toThrow(/full name/);
    expect(() => requirePersonName(undefined)).toThrow(/full name/);
  });

  it('defaults to student and refuses team leader', () => {
    expect(requireProvisionableRole(undefined)).toBe('student');
    expect(requireProvisionableRole('mentor')).toBe('mentor');
    expect(() => requireProvisionableRole('teamLeader')).toThrow(/Student, Parent, Mentor, or Coach/);
  });

  it('gives a provisioned member the account type matching their role', () => {
    // A provisioned student must stay a student for teamCreationRefusal.
    expect(accountTypeForRole('student')).toBe('student');
    expect(accountTypeForRole('coach')).toBe('coach');
  });
});

describe('password reset guard', () => {
  it('allows a reset only for an account this team provisioned', () => {
    expect(() => assertProvisionedByTeam({ provisionedByTeamId: 'team-1' }, 'team-1')).not.toThrow();
  });

  it('refuses a member who signed up on their own, and another team\'s account', () => {
    expect(() => assertProvisionedByTeam({}, 'team-1')).toThrow(/only they can change their password/);
    expect(() => assertProvisionedByTeam(undefined, 'team-1')).toThrow(/only they can change their password/);
    expect(() => assertProvisionedByTeam({ provisionedByTeamId: 'team-2' }, 'team-1')).toThrow(/only they can change their password/);
  });
});
