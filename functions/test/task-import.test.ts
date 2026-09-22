import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, importColumnId, matchAssignees, normalizeImportRows, resolveImportCategories } from '../src/task-import.js';
import { MAX_CATEGORIES_PER_PROJECT } from '../src/kanban.js';

const columns = [
  { id: 'todo', name: 'To do', color: 'blue' },
  { id: 'doing', name: 'Doing', color: 'purple' },
  { id: 'completed', name: 'Done', color: 'green' }
];

describe('normalizeImportRows', () => {
  it('fills defaults and puts the area label first', () => {
    const [row] = normalizeImportRows([{ title: 'Build the base robot', area: 'robot-design', labels: ['build', 'robot-design'], dueAt: '2026-10-01T05:00:00.000Z' }]);
    expect(row).toMatchObject({ title: 'Build the base robot', description: '', priority: 'medium', labels: ['robot-design', 'build'] });
    expect(row.dueAt?.toDate().toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });

  it('accepts a row with no area, labels, or due date', () => {
    expect(normalizeImportRows([{ title: 'Plain', priority: 'urgent', area: '', dueAt: null }])[0]).toMatchObject({ priority: 'urgent', labels: [], dueAt: null });
  });

  it('rejects an empty or oversized import', () => {
    expect(() => normalizeImportRows([])).toThrow('at least one task');
    expect(() => normalizeImportRows('rows')).toThrow('at least one task');
    expect(() => normalizeImportRows(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ title: 'x' })))).toThrow(`at most ${MAX_IMPORT_ROWS}`);
  });

  it('rejects rows the browser preview should have caught', () => {
    expect(() => normalizeImportRows([null])).toThrow('Row 1 is not a task');
    expect(() => normalizeImportRows([['title']])).toThrow('Row 1 is not a task');
    expect(() => normalizeImportRows([{ title: 'a', priority: 'whenever' }])).toThrow('priority');
    expect(() => normalizeImportRows([{ title: 'a', area: 'marketing' }])).toThrow('judging area');
    expect(() => normalizeImportRows([{ title: 'a', labels: 'build' }])).toThrow('at most 10 labels');
    expect(() => normalizeImportRows([{ title: 'a', dueAt: 'someday' }])).toThrow('due date');
    expect(() => normalizeImportRows([{ title: 'a', dueAt: '1850-01-01' }])).toThrow('between 2000 and 2100');
    expect(() => normalizeImportRows([{ title: 'a', dueAt: 20261001 }])).toThrow('due date');
    expect(() => normalizeImportRows([{ title: 'ok' }, { title: '' }])).toThrow('Row 2 title');
  });
});

describe('importColumnId', () => {
  it('defaults to the first column that is not the done column', () => {
    expect(importColumnId(columns, 'completed', null)).toBe('todo');
    expect(importColumnId([columns[2], columns[1]], 'completed', null)).toBe('doing');
  });

  it('honours a requested column and rejects an unknown one', () => {
    expect(importColumnId(columns, 'completed', 'doing')).toBe('doing');
    expect(() => importColumnId(columns, 'completed', 'nope')).toThrow('column not found');
  });
});

describe('import categories', () => {
  const existing = [
    { id: 'build', name: 'Robot build', color: 'blue', areaId: 'robot-design' },
    { id: 'team', name: 'Team', color: 'slate', areaId: null }
  ];

  it('matches an existing category case- and space-insensitively', () => {
    const { created, assigned } = resolveImportCategories(existing, ['  robot BUILD ', 'Team']);
    expect(created).toEqual([]);
    expect(assigned.get('robot build')).toBe('build');
    expect(assigned.get('team')).toBe('team');
  });

  it('creates each unseen name once, whatever the casing in the sheet', () => {
    const { created } = resolveImportCategories(existing, ['Outreach', 'outreach', 'Fundraising', null, '']);
    expect(created.map((category) => category.name)).toEqual(['Outreach', 'Fundraising']);
  });

  it('refuses an import that would push the board past its category limit', () => {
    const full = Array.from({ length: MAX_CATEGORIES_PER_PROJECT }, (_, index) => ({ id: `c${index}`, name: `Category ${index}`, color: 'slate', areaId: null }));
    expect(() => resolveImportCategories(full, ['One more'])).toThrow(HttpsError);
    // Reusing what is already there stays fine at the limit.
    expect(() => resolveImportCategories(full, ['Category 3'])).not.toThrow();
  });
});

describe('assignee matching', () => {
  const members = [
    { userId: 'ada', displayName: 'Ada Lovelace', email: 'ada@example.com' },
    { userId: 'grace', displayName: 'Grace Hopper', email: 'grace@example.com' },
    { userId: 'ada2', displayName: 'Ada Lovelace', email: 'ada.second@example.com' }
  ];

  it('matches an email exactly, even when two teammates share a display name', () => {
    expect(matchAssignees(['ada@example.com'], members)[0]).toMatchObject({ userId: 'ada', reason: 'matched' });
    expect(matchAssignees([' GRACE@example.com '], members)[0]).toMatchObject({ userId: 'grace', reason: 'matched' });
  });

  it('holds back a parent, and says why, instead of assigning them', () => {
    const team = [
      { userId: 'ada', displayName: 'Ada', email: 'ada@example.com', role: 'student' },
      { userId: 'pat', displayName: 'Pat Parent', email: 'pat@example.com', role: 'parent' },
      { userId: 'old', displayName: 'No Role Recorded', email: 'old@example.com' }
    ];
    expect(matchAssignees(['pat@example.com'], team)[0]).toEqual({ value: 'pat@example.com', userId: null, displayName: 'Pat Parent', reason: 'parent' });
    expect(matchAssignees(['Pat Parent'], team)[0]).toMatchObject({ userId: null, reason: 'parent' });
    expect(matchAssignees(['ada@example.com'], team)[0]).toMatchObject({ userId: 'ada', reason: 'matched' });
    // A member whose role was not supplied is matched as before.
    expect(matchAssignees(['old@example.com'], team)[0]).toMatchObject({ userId: 'old', reason: 'matched' });
  });

  it('matches a unique display name, and reports a shared one as ambiguous rather than guessing', () => {
    expect(matchAssignees(['Grace Hopper'], members)[0]).toMatchObject({ userId: 'grace', reason: 'matched' });
    expect(matchAssignees(['ada lovelace'], members)[0]).toMatchObject({ userId: null, reason: 'ambiguous' });
  });

  it('reports an unknown value without confirming whether the address exists elsewhere', () => {
    const match = matchAssignees(['nobody@example.com'], members)[0];
    expect(match).toEqual({ value: 'nobody@example.com', userId: null, displayName: null, reason: 'unknown' });
  });
});

describe('imported rows', () => {
  it('carries the per-row column, category, assignee and subtasks through validation', () => {
    const [row] = normalizeImportRows([{
      title: 'Build the website',
      columnId: 'inProgress',
      categoryName: 'Innovation project',
      assignedTo: 'student-1',
      area: 'innovation-project',
      subtasks: [{ id: 'sub-1', title: 'Build UI', status: 'done', assignedTo: 'student-2', dueAt: null }]
    }]);
    expect(row).toMatchObject({ columnId: 'inProgress', categoryName: 'Innovation project', assignedTo: 'student-1' });
    expect(row.subtasks).toHaveLength(1);
    expect(row.labels).toEqual(['innovation-project']);
  });

  it('keeps one import inside the transaction budget', () => {
    expect(MAX_IMPORT_ROWS).toBe(200);
    expect(() => normalizeImportRows(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ title: 'x' })))).toThrow(/at most 200/);
  });

  it('rejects a subtask list that is not a list of subtasks', () => {
    expect(() => normalizeImportRows([{ title: 'x', subtasks: [{ id: 's', title: 'y', status: 'nope' }] }])).toThrow(HttpsError);
  });
});

