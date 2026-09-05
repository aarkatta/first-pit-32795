import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  GOOGLE_OAUTH_SCOPES,
  buildAuthUrl,
  decryptSecret,
  encryptSecret,
  fromGoogleEventResource,
  requireCalendarId,
  requireGoogleChatUrl,
  shouldApplyRemoteChange,
  toGoogleEventResource,
  toRfc3339
} from '../src/google-calendar';

const key = createHash('sha256').update('test-encryption-key-value').digest();

describe('refresh token encryption', () => {
  it('round-trips a token', () => {
    const token = '1//0abcdefgHIJKLMNOP-refresh';
    expect(decryptSecret(encryptSecret(token, key), key)).toBe(token);
  });

  it('never emits the plaintext and uses a fresh IV each time', () => {
    const token = 'sensitive-refresh-token';
    const a = encryptSecret(token, key);
    const b = encryptSecret(token, key);
    expect(a).not.toContain(token);
    // A reused IV under AES-GCM is a key-recovery bug, not a cosmetic one.
    expect(a).not.toBe(b);
  });

  it('rejects a tampered payload rather than returning garbage', () => {
    const [iv, tag, data] = encryptSecret('token', key).split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => decryptSecret(`${iv}.${tag}.${flipped.toString('base64url')}`, key)).toThrow(/unreadable/i);
    expect(() => decryptSecret('not-a-payload', key)).toThrow(/unreadable/i);
  });
});

describe('buildAuthUrl', () => {
  const config = { clientId: 'client-123', clientSecret: 'secret', redirectUri: 'https://example.test/cb' };

  it('requests offline access so a refresh token comes back', () => {
    const url = new URL(buildAuthUrl(config, 'state-abc'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_OAUTH_SCOPES.join(' '));
  });
});

describe('fromGoogleEventResource', () => {
  it('normalizes a timed event and reads the correlation id', () => {
    const event = fromGoogleEventResource({
      id: 'g-1',
      summary: 'Practice',
      location: 'Gym',
      start: { dateTime: '2026-09-02T15:00:00Z' },
      end: { dateTime: '2026-09-02T17:00:00Z' },
      updated: '2026-09-01T10:00:00Z',
      extendedProperties: { private: { firstPitEventId: 'fp-1' } }
    });
    expect(event?.title).toBe('Practice');
    expect(event?.location).toBe('Gym');
    expect(event?.firstPitEventId).toBe('fp-1');
    expect(event?.cancelled).toBe(false);
  });

  it('treats an all-day event as a midnight span', () => {
    const event = fromGoogleEventResource({ id: 'g-2', summary: 'Competition', start: { date: '2026-09-05' }, end: { date: '2026-09-06' }, updated: '2026-09-01T10:00:00Z' });
    expect(event?.startsAt.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(event?.endsAt.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it('keeps a cancellation, which arrives without dates', () => {
    // A deletion instruction has id + status only. Dropping it for missing
    // dates would leave the removed event visible in First Pit forever.
    const event = fromGoogleEventResource({ id: 'g-3', status: 'cancelled' });
    expect(event?.cancelled).toBe(true);
    expect(event?.googleEventId).toBe('g-3');
  });

  it('discards a resource with no id or unusable dates', () => {
    expect(fromGoogleEventResource({ summary: 'no id' })).toBeNull();
    expect(fromGoogleEventResource({ id: 'g-4', summary: 'no dates' })).toBeNull();
  });

  it('falls back to a title and clamps overlong text', () => {
    const event = fromGoogleEventResource({ id: 'g-5', summary: '   ', description: 'x'.repeat(9000), start: { dateTime: '2026-09-02T15:00:00Z' }, end: { dateTime: '2026-09-02T16:00:00Z' }, updated: '2026-09-01T10:00:00Z' });
    expect(event?.title).toBe('Untitled event');
    expect(event?.description).toHaveLength(4000);
  });
});

describe('shouldApplyRemoteChange', () => {
  it('applies only a strictly newer remote version', () => {
    const synced = Timestamp.fromMillis(1_000_000);
    expect(shouldApplyRemoteChange(new Date(1_000_001), synced)).toBe(true);
    // Equal is the echo of our own push coming back; applying it would restart
    // the loop that two-way sync exists to avoid.
    expect(shouldApplyRemoteChange(new Date(1_000_000), synced)).toBe(false);
    expect(shouldApplyRemoteChange(new Date(999_999), synced)).toBe(false);
  });

  it('treats a never-synced record as stale so the first pull lands', () => {
    expect(shouldApplyRemoteChange(new Date(1), undefined)).toBe(true);
  });
});

describe('toGoogleEventResource', () => {
  it('stamps the correlation id that prevents duplicate mirrors', () => {
    const resource = toGoogleEventResource(
      { id: 'fp-9', title: 'Build session', description: '', location: null, startsAt: Timestamp.fromDate(new Date('2026-09-02T15:00:00Z')), endsAt: Timestamp.fromDate(new Date('2026-09-02T17:00:00Z')) },
      'team-1'
    );
    const extended = resource.extendedProperties as { private: Record<string, string> };
    expect(extended.private.firstPitEventId).toBe('fp-9');
    expect(extended.private.firstPitTeamId).toBe('team-1');
    expect(resource.summary).toBe('Build session');
  });

  it('rejects an unusable date instead of writing a broken event', () => {
    expect(() => toRfc3339('not-a-date')).toThrow();
  });
});

describe('requireGoogleChatUrl', () => {
  it('accepts the two real Chat hosts', () => {
    expect(requireGoogleChatUrl('https://chat.google.com/room/AAA')).toContain('chat.google.com');
    expect(requireGoogleChatUrl('https://mail.google.com/chat/u/0/')).toContain('mail.google.com');
  });

  it('rejects look-alikes, plaintext HTTP and non-URLs', () => {
    expect(() => requireGoogleChatUrl('https://chat.google.com.evil.test/room/1')).toThrow();
    expect(() => requireGoogleChatUrl('http://chat.google.com/room/1')).toThrow();
    expect(() => requireGoogleChatUrl('javascript:alert(1)')).toThrow();
    expect(() => requireGoogleChatUrl('nope')).toThrow();
    expect(() => requireGoogleChatUrl(42)).toThrow();
  });
});

describe('requireCalendarId', () => {
  it('accepts a normal calendar id and rejects path tricks', () => {
    expect(requireCalendarId(' primary ')).toBe('primary');
    expect(requireCalendarId('team@group.calendar.google.com')).toBe('team@group.calendar.google.com');
    // The id is interpolated into a Calendar API path, so traversal characters
    // must never survive validation.
    expect(() => requireCalendarId('../../users/me')).toThrow();
    expect(() => requireCalendarId('a/b')).toThrow();
    expect(() => requireCalendarId('')).toThrow();
  });
});
