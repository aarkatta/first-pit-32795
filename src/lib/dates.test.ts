import { describe, expect, it } from 'vitest';
import { dateInputToIso, dateInputValue, dateTimeInputValue, formatDateLabel, formatDueDate, toDate } from './dates';

const timestamp = (date: Date) => ({ toDate: () => date });

describe('toDate', () => {
  it('accepts the three shapes a Firestore date arrives in', () => {
    const date = new Date('2026-03-07T12:00:00.000Z');
    expect(toDate(timestamp(date))?.toISOString()).toBe(date.toISOString());
    expect(toDate(date)?.toISOString()).toBe(date.toISOString());
    expect(toDate('2026-03-07T12:00:00.000Z')?.toISOString()).toBe(date.toISOString());
  });

  it('returns null for every empty value rather than a bogus date', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
  });

  it('returns null for unparseable values instead of falling back to now', () => {
    expect(toDate('not a date')).toBeNull();
    expect(toDate(timestamp(new Date('nonsense')))).toBeNull();
  });
});

describe('formatting', () => {
  it('renders an empty string for a missing due date and a label otherwise', () => {
    expect(formatDueDate(null)).toBe('');
    expect(formatDueDate(new Date('2026-03-07T12:00:00.000Z'))).toMatch(/Mar/);
  });

  it('substitutes the caller placeholder when there is no date', () => {
    expect(formatDateLabel(null)).toBe('No date');
    expect(formatDateLabel(undefined, 'Recently')).toBe('Recently');
  });
});

describe('input coercion', () => {
  it('produces local-time values, not the UTC slice of an ISO string', () => {
    const date = new Date(2026, 2, 7, 23, 30);
    expect(dateInputValue(date)).toBe('2026-03-07');
    expect(dateTimeInputValue(date)).toBe('2026-03-07T23:30');
  });

  it('returns an empty string for a missing value', () => {
    expect(dateInputValue(null)).toBe('');
    expect(dateTimeInputValue('')).toBe('');
  });

  it('round-trips a date input back to an ISO string, rejecting junk', () => {
    expect(dateInputToIso('2026-03-07')).toBe(new Date('2026-03-07T00:00').toISOString());
    expect(dateInputValue(dateInputToIso('2026-03-07'))).toBe('2026-03-07');
    expect(dateInputToIso('')).toBeNull();
    expect(dateInputToIso('not a date')).toBeNull();
  });
});
