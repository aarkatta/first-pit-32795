import { describe, expect, it } from 'vitest';
import { safeInternalRoute } from './notification-route';

describe('notification routes', () => {
  it('keeps supported internal deep links and maps deferred aliases', () => {
    expect(safeInternalRoute('/knowledge?tab=questions')).toBe('/knowledge?tab=questions');
    expect(safeInternalRoute('/tracker?task=task-1')).toBe('/coordination?task=task-1');
    // Chat is gone, but notifications already delivered still point at it.
    expect(safeInternalRoute('/chat?channel=team-1')).toBe('/coordination');
  });

  it('rejects external, unknown, and malformed destinations', () => {
    expect(safeInternalRoute('https://example.com')).toBe('/coordination');
    expect(safeInternalRoute('//example.com')).toBe('/coordination');
    expect(safeInternalRoute('/admin/delete-all')).toBe('/coordination');
  });
});
