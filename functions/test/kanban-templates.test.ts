import { describe, expect, it } from 'vitest';
import { MAX_CARDS_PER_COLUMN_PAGE, MAX_COLUMNS_PER_PROJECT, MIN_COLUMNS_PER_PROJECT, ORDER_STEP } from '../src/kanban.js';
import {
  BUILT_IN_PROJECT_TEMPLATES,
  BUILT_IN_TEMPLATE_PREFIX,
  MAX_TEMPLATES_PER_TEAM,
  MAX_TEMPLATE_CARDS,
  findBuiltInTemplate,
  isBuiltInTemplateId,
  normalizeCompletedColumnId,
  normalizeTemplateCards,
  normalizeTemplateColumns,
  parseStoredTemplate,
  templateCardOrderKeys
} from '../src/kanban-templates.js';

const columns = [
  { id: 'todo', name: 'To do', color: 'blue' },
  { id: 'doing', name: 'Doing', color: 'purple' },
  { id: 'done', name: 'Done', color: 'green' }
];

describe('Kanban project templates', () => {
  it('ships built-in templates that the column commands can still edit', () => {
    expect(BUILT_IN_PROJECT_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of BUILT_IN_PROJECT_TEMPLATES) {
      expect(template.id.startsWith(BUILT_IN_TEMPLATE_PREFIX)).toBe(true);
      expect(template.source).toBe('builtIn');
      // Every preset has to satisfy the same bounds `createProject` enforces, or a
      // coach could seed a board the workflow editor then refuses to change.
      expect(template.columns.length).toBeGreaterThanOrEqual(MIN_COLUMNS_PER_PROJECT);
      expect(template.columns.length).toBeLessThanOrEqual(MAX_COLUMNS_PER_PROJECT);
      expect(new Set(template.columns.map((column) => column.id)).size).toBe(template.columns.length);
      expect(template.columns.some((column) => column.id === template.completedColumnId)).toBe(true);
      expect(template.cards.length).toBeLessThanOrEqual(MAX_TEMPLATE_CARDS);
      for (const card of template.cards) {
        expect(template.columns.some((column) => column.id === card.columnId)).toBe(true);
        expect(card.title.length).toBeGreaterThan(0);
      }
      // `requireString` rejects a slash, so a preset carrying one would fail only
      // at the moment a coach tried to use it.
      expect(normalizeTemplateCards(template.cards, template.columns)).toHaveLength(template.cards.length);
    }
    expect(new Set(BUILT_IN_PROJECT_TEMPLATES.map((template) => template.id)).size).toBe(BUILT_IN_PROJECT_TEMPLATES.length);
  });

  it('keeps templates and their cards bounded', () => {
    expect(MAX_TEMPLATES_PER_TEAM).toBe(12);
    expect(MAX_TEMPLATE_CARDS).toBe(40);
  });

  it('resolves built-in ids and refuses unknown ones', () => {
    const first = BUILT_IN_PROJECT_TEMPLATES[0];
    expect(isBuiltInTemplateId(first.id)).toBe(true);
    expect(isBuiltInTemplateId('AbC123')).toBe(false);
    expect(findBuiltInTemplate(first.id)?.name).toBe(first.name);
    expect(findBuiltInTemplate(`${BUILT_IN_TEMPLATE_PREFIX}nope`)).toBeNull();
  });

  it('rejects a stored workflow that is outside the project column bounds', () => {
    expect(normalizeTemplateColumns(columns)).toHaveLength(3);
    expect(() => normalizeTemplateColumns([columns[0]])).toThrow(/between/i);
    expect(() => normalizeTemplateColumns(Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, name: `C${index}`, color: 'slate' })))).toThrow(/between/i);
    expect(() => normalizeTemplateColumns([columns[0], columns[0], columns[1]])).toThrow(/repeat/i);
    expect(() => normalizeTemplateColumns('nope')).toThrow(/workflow is invalid/i);
  });

  it('falls back to the last column when the completion column is gone', () => {
    expect(normalizeCompletedColumnId('doing', columns)).toBe('doing');
    expect(normalizeCompletedColumnId('removed', columns)).toBe('done');
    expect(normalizeCompletedColumnId(undefined, columns)).toBe('done');
  });

  it('drops cards that point at a column the template no longer has', () => {
    const cards = normalizeTemplateCards([
      { columnId: 'todo', title: 'Keep me' },
      { columnId: 'deleted', title: 'Drop me' },
      'not a card',
      { columnId: 'doing', title: 'Keep me too', priority: 'urgent', labels: ['build'] }
    ], columns);
    expect(cards.map((card) => card.title)).toEqual(['Keep me', 'Keep me too']);
    expect(cards[0]).toMatchObject({ description: '', priority: 'medium', labels: [] });
    expect(cards[1].priority).toBe('urgent');
  });

  it('never seeds a column past the page the board can load', () => {
    const overfull = Array.from({ length: MAX_TEMPLATE_CARDS }, (_, index) => ({ columnId: 'todo', title: `Card ${index}` }));
    expect(normalizeTemplateCards(overfull, columns)).toHaveLength(Math.min(MAX_TEMPLATE_CARDS, MAX_CARDS_PER_COLUMN_PAGE));
    expect(() => normalizeTemplateCards(Array.from({ length: MAX_TEMPLATE_CARDS + 1 }, () => ({ columnId: 'todo', title: 'x' })), columns)).toThrow(/at most/i);
    expect(normalizeTemplateCards(undefined, columns)).toEqual([]);
  });

  it('normalises an unknown priority instead of failing the whole template', () => {
    expect(normalizeTemplateCards([{ columnId: 'todo', title: 'x', priority: 'critical' }], columns)[0].priority).toBe('medium');
  });

  it('spaces starter cards per column the way the board does', () => {
    const keys = templateCardOrderKeys([
      { columnId: 'todo', title: 'a', description: '', priority: 'medium', labels: [] },
      { columnId: 'doing', title: 'b', description: '', priority: 'medium', labels: [] },
      { columnId: 'todo', title: 'c', description: '', priority: 'medium', labels: [] }
    ]);
    expect(keys).toEqual([ORDER_STEP, ORDER_STEP, ORDER_STEP * 2]);
  });

  it('parses a stored template as a team template regardless of what it claims', () => {
    const template = parseStoredTemplate('saved1', {
      name: 'Our board',
      description: 'Saved from last season.',
      source: 'builtIn',
      columns,
      completedColumnId: 'done',
      cards: [{ columnId: 'todo', title: 'First card' }]
    });
    expect(template).toMatchObject({ id: 'saved1', source: 'team', name: 'Our board', completedColumnId: 'done' });
    expect(template.cards).toHaveLength(1);
  });
});
