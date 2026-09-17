import { describe, expect, it } from 'vitest';
import { DASHBOARD_AREAS, areaProgress, summarizeUnreadNotifications } from '../src/phase7.js';

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
