import { describe, expect, it } from 'vitest';
import { COLUMN_COLORS, MAX_CARDS_PER_COLUMN_PAGE, MAX_CATEGORIES_PER_PROJECT } from '../src/kanban.js';
import { DASHBOARD_AREAS } from '../src/phase7.js';
import { buildStandardPlan, standardWeekLabel } from '../src/standard-plan.js';

describe('standard season plan seed', () => {
  const plan = buildStandardPlan();

  it('seeds the four template categories, each tied to its judging area', () => {
    expect(plan.categories.map((category) => [category.name, category.areaId])).toEqual([
      ['Project Mgmt & Core Values', 'core-values'],
      ['Innovation Project', 'innovation-project'],
      ['Robot Design', 'robot-design'],
      ['Robot Game', 'robot-game']
    ]);
    const areaIds: string[] = DASHBOARD_AREAS.map((area) => area.id);
    for (const category of plan.categories) {
      expect(areaIds).toContain(category.areaId);
      expect(COLUMN_COLORS).toContain(category.color);
      expect(category.goalId).toBeNull();
    }
    expect(new Set(plan.categories.map((category) => category.id)).size).toBe(plan.categories.length);
  });

  it('seeds every template task within the board limits, area label first', () => {
    expect(plan.cards).toHaveLength(48);
    expect(plan.cards.length).toBeLessThanOrEqual(MAX_CARDS_PER_COLUMN_PAGE);
    expect(plan.categories.length).toBeLessThanOrEqual(MAX_CATEGORIES_PER_PROJECT);
    expect(plan.cards[0]).toEqual({
      title: 'Establish roles; set goals; review rubrics',
      description: '',
      categoryId: 'standard-core-values',
      labels: ['core-values', 'week-01']
    });
    for (const card of plan.cards) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.title.length).toBeLessThanOrEqual(160);
      expect(plan.categories.some((category) => category.id === card.categoryId)).toBe(true);
      expect(card.labels[1]).toMatch(/^week-\d{2}$/);
    }
    expect(plan.cards.at(-1)?.labels).toEqual(['robot-game', 'week-12']);
  });

  it('still seeds a category the list adds later, without inventing an area', () => {
    const custom = buildStandardPlan([
      { taskId: 'X-1', week: 3, category: 'Outreach', title: 'Visit the library', status: 'Not Started', notes: 'Bring the robot' },
      { taskId: 'X-2', week: 0, category: '', title: 'Uncategorised', status: 'Not Started' }
    ]);
    expect(custom.categories).toEqual([{ id: 'standard-outreach', name: 'Outreach', color: 'slate', areaId: null, goalId: null }]);
    expect(custom.cards).toEqual([
      { title: 'Visit the library', description: 'Bring the robot', categoryId: 'standard-outreach', labels: ['week-03'] },
      { title: 'Uncategorised', description: '', categoryId: null, labels: [] }
    ]);
  });

  it('writes weeks the way the spreadsheet importer does', () => {
    expect(standardWeekLabel(1)).toBe('week-01');
    expect(standardWeekLabel(12)).toBe('week-12');
    expect(standardWeekLabel(0)).toBeNull();
    expect(standardWeekLabel('x')).toBeNull();
  });
});
