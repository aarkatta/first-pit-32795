import { describe, expect, it } from 'vitest';
import { areaRows, dashboardHighlights, percentOf } from './dashboard-view';

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

describe('dashboardHighlights', () => {
  it('lists achieved milestones with their completion date', () => {
    const highlights = dashboardHighlights({
      completedGoals: [{ id: 'g1', title: 'Finish the base robot', updatedAt: '2026-10-02T12:00:00.000Z' }, { id: 'g2', title: '' }]
    });
    expect(highlights.map((highlight) => highlight.id)).toEqual(['goal:g1', 'goal:g2']);
    expect(highlights[0].detail).toMatch(/^Milestone achieved · /);
    expect(highlights[1]).toMatchObject({ title: 'Milestone', detail: 'Milestone achieved' });
  });

  it('returns nothing for a team without finished goals', () => {
    expect(dashboardHighlights({ completedGoals: [] })).toEqual([]);
  });

  it('respects the limit', () => {
    expect(dashboardHighlights({ completedGoals: [{ id: 'g1', title: 'One' }, { id: 'g2', title: 'Two' }] }, 1)).toHaveLength(1);
  });
});
