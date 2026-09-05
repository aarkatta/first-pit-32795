import { describe, expect, it } from 'vitest';
import { isGoogleChatUrl } from './google-service';

describe('isGoogleChatUrl', () => {
  it('accepts the two real Google Chat hosts', () => {
    expect(isGoogleChatUrl('https://chat.google.com/room/AAAA1111')).toBe(true);
    expect(isGoogleChatUrl('https://mail.google.com/chat/u/0/#chat/space/AAAA')).toBe(true);
    expect(isGoogleChatUrl('  https://chat.google.com/dm/xyz  ')).toBe(true);
  });

  it('rejects look-alike hosts, other schemes and junk', () => {
    // The link is rendered for the whole team, so a look-alike host would be a
    // phishing vector rather than a cosmetic problem.
    expect(isGoogleChatUrl('https://chat.google.com.evil.test/room/1')).toBe(false);
    expect(isGoogleChatUrl('https://evil.test/chat.google.com')).toBe(false);
    expect(isGoogleChatUrl('http://chat.google.com/room/1')).toBe(false);
    expect(isGoogleChatUrl('javascript:alert(1)')).toBe(false);
    expect(isGoogleChatUrl('not a url')).toBe(false);
    expect(isGoogleChatUrl('')).toBe(false);
  });
});
