import { describe, expect, it } from 'vitest';
import { credentialsMessage, credentialsSubject } from './member-credentials';

const base = {
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  temporaryPassword: 'FLL2026',
  teamName: 'Robotics',
  teamNumber: '12345',
  coachName: 'Dana Ruiz'
};

describe('credentialsMessage', () => {
  it('greets the member by first name and carries everything they need', () => {
    const message = credentialsMessage(base);
    expect(message).toContain('Hi Ada,');
    expect(message).toContain('Robotics · Team #12345');
    expect(message).toContain('ada@example.com');
    expect(message).toContain('FLL2026');
    expect(message).toContain(window.location.origin);
    expect(message).toContain('— Dana Ruiz');
  });

  it('tells the member the starter password is temporary', () => {
    // Otherwise the message reads as something worth keeping, and a password in
    // a mailbox is exactly what the forced change exists to undo.
    expect(credentialsMessage(base)).toMatch(/choose your own password straight away/i);
    expect(credentialsMessage(base)).toMatch(/do not need to keep this message/i);
  });

  it('degrades without a team number or a coach name', () => {
    const message = credentialsMessage({ ...base, teamNumber: null, coachName: null });
    expect(message).toContain('Robotics is ready');
    expect(message).not.toContain('Team #');
    expect(message).not.toContain('—');
  });

  it('falls back to a greeting when the name is unusable', () => {
    expect(credentialsMessage({ ...base, displayName: '   ' })).toContain('Hi there,');
  });

  it('titles the message after the team', () => {
    expect(credentialsSubject({ teamName: 'Robotics', teamNumber: '12345' })).toBe('Your First Pit account for Robotics · Team #12345');
    expect(credentialsSubject({ teamName: 'Robotics', teamNumber: null })).toBe('Your First Pit account for Robotics');
  });
});
