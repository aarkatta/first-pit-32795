import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { areaProgress, pickPublicFields, summarizeUnreadNotifications } from '../src/phase7.js';
import { ALL_AREA_IDS, PROGRAM_AREAS, teamProgram } from '../src/programs.js';

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
    expect(PROGRAM_AREAS.fll.map((area) => area.id)).toEqual(['innovation-project', 'robot-design', 'robot-game', 'core-values']);
  });

  it('tracks the seven FTC awards, Think on its own and the rest in their award groups', () => {
    expect(PROGRAM_AREAS.ftc.map((area) => [area.id, area.group])).toEqual([
      ['think', null],
      ['control', 'mci'],
      ['design', 'mci'],
      ['innovate', 'mci'],
      ['connect', 'ta'],
      ['sustain', 'ta'],
      ['reach', 'ta']
    ]);
    expect(new Set(ALL_AREA_IDS).size).toBe(ALL_AREA_IDS.length);
  });

  it('treats a team with no program, or anything but ftc, as FLL', () => {
    expect(teamProgram(undefined)).toBe('fll');
    expect(teamProgram({})).toBe('fll');
    expect(teamProgram({ program: 'FTC' })).toBe('fll');
    expect(teamProgram({ program: 'ftc' })).toBe('ftc');
  });

  it("follows the team's program", () => {
    const areas = areaProgress([{ taskCount: 8, completedTaskCount: 2 }], 'ftc');
    expect(areas).toHaveLength(7);
    expect(areas[0]).toEqual({ id: 'think', label: 'Think', group: null, taskCount: 8, completedTaskCount: 2 });
    expect(areas[6]).toMatchObject({ id: 'reach', group: 'ta', taskCount: 0 });
  });

  it('pairs counts with areas by position', () => {
    const areas = areaProgress([
      { taskCount: 4, completedTaskCount: 1 },
      { taskCount: 0, completedTaskCount: 0 },
      { taskCount: 10, completedTaskCount: 7 },
      { taskCount: 2, completedTaskCount: 2 }
    ]);
    expect(areas[2]).toEqual({ id: 'robot-game', label: 'Robot game', group: null, taskCount: 10, completedTaskCount: 7 });
    expect(areas).toHaveLength(4);
  });

  it('never reports more completed than total, or negative counts', () => {
    const areas = areaProgress([{ taskCount: 3, completedTaskCount: 9 }, { taskCount: -2, completedTaskCount: -1 }]);
    expect(areas[0]).toMatchObject({ taskCount: 3, completedTaskCount: 3 });
    expect(areas[1]).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
    expect(areas[3]).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
  });
});
