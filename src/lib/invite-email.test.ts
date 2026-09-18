import { describe, expect, it } from 'vitest';
import { inviteEmailBody, inviteEmailSubject, inviteGmailHref, inviteMailtoHref } from './invite-email';

const input = {
  email: 'student+fll@example.com',
  link: 'https://www.first-pit.com/join?invite=abc_123',
  role: 'student',
  teamName: 'NC FTC Apex',
  teamNumber: '987654',
  inviterName: 'Coach Kim'
};

describe('invite email', () => {
  it('names the team and its number in the subject', () => {
    expect(inviteEmailSubject(input)).toBe('Join NC FTC Apex · Team #987654 on First Pit');
    expect(inviteEmailSubject({ teamName: 'NC FTC Apex', teamNumber: null })).toBe('Join NC FTC Apex on First Pit');
  });

  it('writes the link, the address to sign in with, the role and the sender', () => {
    const body = inviteEmailBody(input);
    expect(body).toContain('as a student.');
    expect(body).toContain('Open this link: https://www.first-pit.com/join?invite=abc_123');
    expect(body).toContain('with this email address: student+fll@example.com');
    expect(body.endsWith('— Coach Kim')).toBe(true);
    expect(inviteEmailBody({ ...input, role: 'teamLeader', inviterName: '' })).toContain('as a team leader.');
    expect(inviteEmailBody({ ...input, inviterName: null })).not.toContain('—');
  });

  it('opens Gmail compose with the recipient, subject and body filled in', () => {
    const url = new URL(inviteGmailHref(input));
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('to')).toBe('student+fll@example.com');
    expect(url.searchParams.get('su')).toBe(inviteEmailSubject(input));
    expect(url.searchParams.get('body')).toBe(inviteEmailBody(input));
  });

  it('builds a mailto link that mail apps decode back to the same message', () => {
    const href = inviteMailtoHref(input);
    expect(href.startsWith('mailto:student%2Bfll%40example.com?subject=')).toBe(true);
    expect(href).not.toContain('+');
    const params = new URL(href).searchParams;
    expect(params.get('subject')).toBe(inviteEmailSubject(input));
    expect(params.get('body')).toBe(inviteEmailBody(input).replace(/\n/g, '\r\n'));
  });
});
