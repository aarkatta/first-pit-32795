import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROJECT_COLUMNS,
  MAX_CARDS_PER_COLUMN_PAGE,
  MAX_COLUMNS_PER_PROJECT,
  MAX_PROJECTS_PER_TEAM,
  MIN_COLUMNS_PER_PROJECT,
  columnHasCapacity,
  describeFirestoreFailure,
  legacyOrderKey,
  legacyTaskColumn,
  categoryGoalId,
  MAX_CATEGORIES_PER_PROJECT,
  nextProjectVersion,
  orderBetween,
  projectCategories,
  requireCategoryId,
  updateProject as updateProjectCommand,
  withBoardErrors
} from '../src/kanban.js';

describe('Release 1.1 Kanban invariants', () => {
  it('seeds the compatible four-column workflow', () => {
    expect(DEFAULT_PROJECT_COLUMNS.map((column) => column.id)).toEqual(['todo', 'inProgress', 'review', 'completed']);
    expect(DEFAULT_PROJECT_COLUMNS.at(-1)?.name).toBe('Completed');
  });

  it('keeps projects, columns, and column pages bounded', () => {
    expect(MAX_PROJECTS_PER_TEAM).toBe(10);
    expect(MIN_COLUMNS_PER_PROJECT).toBe(2);
    expect(MAX_COLUMNS_PER_PROJECT).toBe(8);
    expect(MAX_CARDS_PER_COLUMN_PAGE).toBe(150);
    expect(MAX_CATEGORIES_PER_PROJECT).toBe(20);
    expect(columnHasCapacity(149)).toBe(true);
    expect(columnHasCapacity(150)).toBe(false);
    expect(columnHasCapacity(150, true)).toBe(true);
    expect(columnHasCapacity(151, true)).toBe(false);
  });

  it('maps every legacy tracker status without losing tasks', () => {
    expect(legacyTaskColumn('todo')).toBe('todo');
    expect(legacyTaskColumn('inProgress')).toBe('inProgress');
    expect(legacyTaskColumn('review')).toBe('review');
    expect(legacyTaskColumn('completed')).toBe('completed');
    expect(legacyTaskColumn('unknown')).toBe('todo');
    expect(legacyOrderKey(0)).toBe(1024);
    expect(legacyOrderKey(200)).toBe(205824);
    expect(() => legacyOrderKey(-1)).toThrow(/ordering is invalid/i);
  });

  it('generates stable order keys at every insertion boundary', () => {
    expect(orderBetween()).toBe(1024);
    expect(orderBetween(1024)).toBe(2048);
    expect(orderBetween(undefined, 1024)).toBe(0);
    expect(orderBetween(1024, 2048)).toBe(1536);
    expect(() => orderBetween(2048, 1024)).toThrow(/order changed/i);
  });

  it('translates Firestore status codes into actionable client errors', () => {
    // A missing or building composite index is the failure that used to reach the UI
    // as a bare INTERNAL [500]. The guidance is public; the raw Firestore text is not.
    const indexFailure = { code: 9, message: 'The query requires an index. Create it here: https://console.firebase.google.com/project/first-pit-prod/x' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => describeFirestoreFailure(indexFailure))
      .toThrow(/index this board needs is missing or still building/i);
    // A student or parent must never see the project id, collection paths, or the
    // index console link that the Firestore message carries.
    expect(() => describeFirestoreFailure(indexFailure)).not.toThrow(/console\.firebase\.google\.com/);
    expect(() => describeFirestoreFailure(indexFailure)).not.toThrow(/first-pit-prod/);
    // A platform admin, and only a platform admin, gets the operator detail.
    expect(() => describeFirestoreFailure(indexFailure, true)).toThrow(/console\.firebase\.google\.com/);
    // Either way the operator detail reaches the logs.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
    expect(() => describeFirestoreFailure({ code: 7 })).toThrow(/not allowed to read/i);
    expect(() => describeFirestoreFailure({ code: 10 })).toThrow(/changed while this request ran/i);
    expect(() => describeFirestoreFailure({ code: 8 })).toThrow(/rate limiting/i);
    expect(() => describeFirestoreFailure({ code: 14 })).toThrow(/did not respond in time/i);
    expect(() => describeFirestoreFailure({ code: 4 })).toThrow(/did not respond in time/i);
    expect(() => describeFirestoreFailure({ code: 5 })).toThrow(/was not found/i);
  });

  it('keeps an existing HttpsError intact and never leaks an unknown failure', async () => {
    const typed = new HttpsError('permission-denied', 'Students can move only tasks assigned to them.');
    expect(() => describeFirestoreFailure(typed)).toThrow(typed);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => describeFirestoreFailure(new Error('connect ECONNREFUSED 10.0.0.1:443')))
      .toThrow(/could not be loaded. The server logged the reason/i);
    // The raw text is logged for an operator, not returned to the caller.
    expect(consoleError).toHaveBeenCalled();
    expect(() => describeFirestoreFailure(new Error('connect ECONNREFUSED 10.0.0.1:443'))).not.toThrow(/ECONNREFUSED/);
    consoleError.mockRestore();
  });

  it('passes a successful command through untouched', async () => {
    const command = vi.fn(async (request: { teamId: string }) => ({ projectId: request.teamId }));
    await expect(withBoardErrors(command)({ teamId: 'team-1' })).resolves.toEqual({ projectId: 'team-1' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(withBoardErrors(async () => { throw { code: 9, message: 'needs an index' }; })({}))
      .rejects.toThrow(/index this board needs/i);
    // withBoardErrors reads the caller's token to decide whether the operator
    // detail may be echoed back.
    await expect(withBoardErrors(async () => { throw { code: 9, message: 'PRIVATE-INDEX-LINK' }; })({ auth: { token: {} } }))
      .rejects.not.toThrow(/PRIVATE-INDEX-LINK/);
    await expect(withBoardErrors(async () => { throw { code: 9, message: 'PRIVATE-INDEX-LINK' }; })({ auth: { token: { platformAdmin: true } } }))
      .rejects.toThrow(/PRIVATE-INDEX-LINK/);
    consoleError.mockRestore();
  });

  it('rejects a stale project workflow edit and defaults a pre-version project to 1', () => {
    // Column edits rewrite the whole array, so a version mismatch has to abort
    // rather than silently overwrite a concurrent admin's rename or reorder.
    expect(nextProjectVersion(3, 3)).toBe(4);
    expect(nextProjectVersion(undefined, 1)).toBe(2);
    expect(nextProjectVersion(null, 1)).toBe(2);
    expect(() => nextProjectVersion(4, 3)).toThrow(/changed while you were editing/i);
    expect(() => nextProjectVersion(1, undefined)).toThrow(/positive integer/i);
    expect(() => nextProjectVersion(1, 0)).toThrow(/positive integer/i);
    expect(() => nextProjectVersion(1, 'two')).toThrow(/positive integer/i);
  });

  it('validates updateProject input before it can touch a project document', async () => {
    // updateProject has no client caller yet; these assertions keep its input
    // contract honest. A platform-admin token short-circuits requireTeamAdmin,
    // so validation is reached without any Firestore access.
    const platformAdmin = { auth: { uid: 'admin-1', token: { platformAdmin: true } } };
    const call = (data: Record<string, unknown>) => updateProjectCommand({ ...platformAdmin, data } as never);

    await expect(call({ teamId: 'team-1', projectId: 'project-1' })).rejects.toThrow(/No project changes were provided/i);
    await expect(call({ projectId: 'project-1', name: 'Board' })).rejects.toThrow(/Team ID is required/i);
    await expect(call({ teamId: 'team-1', name: 'Board' })).rejects.toThrow(/Project ID is required/i);
    await expect(call({ teamId: 'team-1', projectId: 'project-1', name: '' })).rejects.toThrow(/Project name/i);
    await expect(call({ teamId: 'team-1', projectId: 'project-1', name: 'x'.repeat(81) })).rejects.toThrow(/Project name/i);
    await expect(call({ teamId: 'team-1', projectId: 'project-1', description: 'x'.repeat(1001) })).rejects.toThrow(/Project description/i);
    // A path separator in an ID would let a caller escape the collection.
    await expect(call({ teamId: 'team-1', projectId: '../projects/other', name: 'Board' })).rejects.toThrow(/Project ID is invalid/i);
  });
});

describe('board categories', () => {
  it('reads a board saved before categories existed as having none', () => {
    expect(projectCategories({})).toEqual([]);
    expect(projectCategories({ categories: null })).toEqual([]);
  });

  it('keeps the stored shape and drops an unknown judging area', () => {
    const categories = projectCategories({
      categories: [
        { id: 'build', name: 'Build', color: 'blue', areaId: 'robot-design' },
        { id: 'misc', name: 'Misc', color: 'not-a-colour', areaId: 'not-an-area' }
      ]
    });
    expect(categories).toEqual([
      { id: 'build', name: 'Build', color: 'blue', areaId: 'robot-design', goalId: null },
      { id: 'misc', name: 'Misc', color: 'slate', areaId: null, goalId: null }
    ]);
  });

  it('rejects a malformed category list rather than guessing', () => {
    expect(() => projectCategories({ categories: 'build' })).toThrow(HttpsError);
    expect(() => projectCategories({ categories: ['build'] })).toThrow(HttpsError);
  });

  it('reads the milestone a category rolls up into', () => {
    const categories = projectCategories({
      categories: [
        { id: 'build', name: 'Build', color: 'blue', areaId: null, goalId: 'goal-1' },
        { id: 'loose', name: 'Loose', color: 'slate', areaId: null }
      ]
    });
    expect(categoryGoalId(categories, 'build')).toBe('goal-1');
    expect(categoryGoalId(categories, 'loose')).toBeNull();
    expect(categoryGoalId(categories, null)).toBeNull();
    // A card in a category the board no longer defines belongs to no milestone
    // rather than to a stale one.
    expect(categoryGoalId(categories, 'deleted')).toBeNull();
  });

  it('accepts only a category the board actually defines', () => {
    const categories = projectCategories({ categories: [{ id: 'build', name: 'Build', color: 'blue', areaId: null }] });
    expect(requireCategoryId(categories, 'build')).toBe('build');
    expect(requireCategoryId(categories, null)).toBeNull();
    expect(requireCategoryId(categories, '')).toBeNull();
    expect(() => requireCategoryId(categories, 'other-board-category')).toThrow(HttpsError);
  });
});

