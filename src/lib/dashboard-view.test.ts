import { describe, expect, it } from 'vitest';
import {
  areaRows,
  axisTicks,
  dashboardHighlights,
  nearestPointIndex,
  niceCeiling,
  percentOf,
  scoreTrendPoints,
  trendGeometry
} from './dashboard-view';
import type { DashboardScore } from './phase7-service';

const scores: DashboardScore[] = [
  { id: 'c', title: 'Regional qualifier', scoreType: 'match', totalPoints: 410, sessionDate: '2026-10-20T15:00:00.000Z' },
  { id: 'b', title: 'Tuesday runs', scoreType: 'practice', totalPoints: 285, sessionDate: '2026-10-14T15:00:00.000Z' },
  { id: 'a', scoreType: 'practice', totalPoints: 190, sessionDate: '2026-10-07T15:00:00.000Z' },
  { id: 'undated', scoreType: 'practice', totalPoints: 500, sessionDate: null },
  { id: 'unscored', scoreType: 'match', sessionDate: '2026-10-21T15:00:00.000Z' }
];

describe('percentOf', () => {
  it('rounds a bounded percentage and treats an empty total as zero', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(-1, 4)).toBe(0);
    expect(percentOf(Number.NaN, 4)).toBe(0);
  });
});

describe('areaRows', () => {
  it('adds a completion percentage to each judging area', () => {
    expect(areaRows([{ id: 'robot-game', label: 'Robot game', taskCount: 8, completedTaskCount: 6 }])).toEqual([
      { id: 'robot-game', label: 'Robot game', taskCount: 8, completedTaskCount: 6, percent: 75 }
    ]);
    expect(areaRows(undefined)).toEqual([]);
  });
});

describe('scoreTrendPoints', () => {
  it('orders sessions chronologically and skips ones without a date or total', () => {
    const points = scoreTrendPoints(scores);
    expect(points.map((point) => point.id)).toEqual(['a', 'b', 'c']);
    expect(points[0]).toMatchObject({ title: 'Practice session', scoreType: 'practice', points: 190 });
    expect(points[2]).toMatchObject({ title: 'Regional qualifier', scoreType: 'match' });
  });

  it('titles an untitled match session by its type', () => {
    expect(scoreTrendPoints([{ id: 'm', scoreType: 'match', totalPoints: 10, sessionDate: '2026-10-01T00:00:00.000Z' }])[0].title).toBe('Match session');
  });
});

describe('axis scale', () => {
  it('rounds the ceiling up to a clean number', () => {
    expect(niceCeiling(0)).toBe(10);
    expect(niceCeiling(410)).toBe(500);
    expect(niceCeiling(180)).toBe(200);
    expect(niceCeiling(230)).toBe(250);
    expect(niceCeiling(1000)).toBe(1000);
    expect(niceCeiling(Number.POSITIVE_INFINITY)).toBe(10);
  });

  it('splits the ceiling into evenly spaced ticks', () => {
    expect(axisTicks(500)).toEqual([0, 125, 250, 375, 500]);
  });
});

describe('dashboardHighlights', () => {
  it('leads with the best recent match and practice, then achieved milestones', () => {
    const highlights = dashboardHighlights({
      scores,
      completedGoals: [{ id: 'g1', title: 'Finish the base robot', updatedAt: '2026-10-02T12:00:00.000Z' }, { id: 'g2', title: '' }]
    });
    expect(highlights.map((highlight) => highlight.id)).toEqual(['score:c', 'score:b', 'goal:g1', 'goal:g2']);
    expect(highlights[0].title).toBe('410 pts · Best recent match');
    expect(highlights[2].detail).toMatch(/^Milestone achieved · /);
    expect(highlights[3]).toMatchObject({ title: 'Milestone', detail: 'Milestone achieved' });
  });

  it('returns nothing for a team without scores or finished goals', () => {
    expect(dashboardHighlights({ scores: [], completedGoals: [] })).toEqual([]);
  });

  it('respects the limit', () => {
    expect(dashboardHighlights({ scores, completedGoals: [{ id: 'g1', title: 'One' }] }, 1)).toHaveLength(1);
  });
});

describe('trendGeometry', () => {
  it('spreads sessions across the plot on a zero-based scale', () => {
    const geometry = trendGeometry(scoreTrendPoints(scores), 600, 200);
    expect(geometry.ceiling).toBe(500);
    expect(geometry.points[0].x).toBe(geometry.plot.left);
    expect(geometry.points[2].x).toBe(geometry.plot.right);
    expect(geometry.ticks[0]).toEqual({ value: 0, y: geometry.plot.bottom });
    expect(geometry.ticks[4]).toEqual({ value: 500, y: geometry.plot.top });
    expect(geometry.linePath.startsWith('M')).toBe(true);
    expect(geometry.areaPath.endsWith('Z')).toBe(true);
  });

  it('centres a single session and draws no area', () => {
    const geometry = trendGeometry(scoreTrendPoints([scores[0]]), 600, 200);
    expect(geometry.points[0].x).toBe(geometry.plot.left + (geometry.plot.right - geometry.plot.left) / 2);
    expect(geometry.areaPath).toBe('');
  });

  it('keeps a usable plot at very small sizes', () => {
    const geometry = trendGeometry([], 10, 10);
    expect(geometry.plot.right).toBeGreaterThan(geometry.plot.left);
    expect(geometry.plot.bottom).toBeGreaterThan(geometry.plot.top);
  });
});

describe('nearestPointIndex', () => {
  it('snaps to the closest x position', () => {
    expect(nearestPointIndex([{ x: 0 }, { x: 100 }, { x: 200 }], 140)).toBe(1);
    expect(nearestPointIndex([{ x: 0 }, { x: 100 }], 90)).toBe(1);
    expect(nearestPointIndex([], 10)).toBe(-1);
  });
});
