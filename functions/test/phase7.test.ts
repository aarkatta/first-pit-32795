import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_AREAS, areaProgress, pickPublicFields, summarizeUnreadNotifications } from '../src/phase7.js';

describe('Phase 7 dashboard record serialization', () => {
  it('sends Firestore timestamps as ISO strings the client can parse', () => {
    const dueAt = Timestamp.fromDate(new Date('2026-09-20T15:00:00.000Z'));
    const record = pickPublicFields('task-1', { title: 'Build arm', dueAt, readAt: null, secret: 'x' }, ['title', 'dueAt', 'readAt', 'missing']);
    expect(record).toEqual({ id: 'task-1', title: 'Build arm', dueAt: '2026-09-20T15:00:00.000Z', readAt: null });
    // The bare shape a callable would otherwise send — and that the client's
    // date parser rejected — must not survive JSON encoding.
    expect(JSON.stringify(record)).not.toContain('_seconds');
    expect(new Date(String(record.dueAt)).getTime()).toBe(dueAt.toMillis());
  });
});

describe('Phase 7 truthful bounded notification summary', () => {
  it('reports the read boundary as truncated once the cap is hit', () => {
    const records = Array.from({ length: 50 }, () => ({ type: 'task.updated' }));
    expect(summarizeUnreadNotifications(records)).toEqual({
      unreadSummaryTruncated: true,
      unreadSummaryLimit: 50
    });
  });

  it('reports a short page as complete rather than truncated', () => {
    expect(summarizeUnreadNotifications([{ type: 'task.assigned' }])).toEqual({
      unreadSummaryTruncated: false,
      unreadSummaryLimit: 50
    });
  });
});

describe('Dashboard area progress', () => {
  it('labels every FLL judging area in a fixed order', () => {
    expect(DASHBOARD_AREAS.map((area) => area.id)).toEqual(['innovation-project', 'robot-design', 'robot-game', 'core-values']);
  });

  it('pairs counts with areas by position', () => {
    const areas = areaProgress([
      { taskCount: 4, completedTaskCount: 1 },
      { taskCount: 0, completedTaskCount: 0 },
      { taskCount: 10, completedTaskCount: 7 },
      { taskCount: 2, completedTaskCount: 2 }
    ]);
    expect(areas[2]).toEqual({ id: 'robot-game', label: 'Robot game', taskCount: 10, completedTaskCount: 7 });
    expect(areas).toHaveLength(4);
  });

  it('never reports more completed than total, or negative counts', () => {
    const areas = areaProgress([{ taskCount: 3, completedTaskCount: 9 }, { taskCount: -2, completedTaskCount: -1 }]);
    expect(areas[0]).toMatchObject({ taskCount: 3, completedTaskCount: 3 });
    expect(areas[1]).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
    expect(areas[3]).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
  });
});
