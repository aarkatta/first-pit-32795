import type * as FirestoreModule from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for the search pagination fix.
 *
 * `searchQuestions` and `searchVideos` used to build the query as
 * `.orderBy().limit().startAfter().where(...)`. The Firestore SDK rejects any
 * `where()` applied after a cursor, so the SECOND page of every knowledge search
 * threw — a failure invisible to any test that only ever passed a null cursor.
 * These tests drive a fake query builder that records the call order and fails
 * the same way Firestore does.
 */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  docs: [] as Array<{ id: string; data: () => Record<string, unknown> }>
}));

function makeQuery() {
  let cursorSeen = false;
  const query: Record<string, unknown> = {};
  for (const method of ['where', 'orderBy', 'limit', 'startAfter'] as const) {
    query[method] = (...args: unknown[]) => {
      state.calls.push(method);
      // Mirror the SDK: a filter after a cursor is a hard error.
      if (method === 'where' && cursorSeen) throw new Error('Cannot specify a where() filter after calling startAfter().');
      if (method === 'startAfter') cursorSeen = true;
      void args;
      return query;
    };
  }
  query.get = async () => ({ docs: state.docs, size: state.docs.length, empty: state.docs.length === 0 });
  return query;
}

vi.mock('firebase-admin/firestore', async () => {
  const actual = await vi.importActual<typeof FirestoreModule>('firebase-admin/firestore');
  return {
    ...actual,
    getFirestore: () => ({
      collection: (name: string) => {
        state.calls.push(`collection:${name}`);
        return makeQuery();
      },
      doc: () => ({ id: 'generated-id' })
    })
  };
});

const { searchQuestions, searchVideos } = await import('../src/phase5.js');

const request = (data: Record<string, unknown>) => ({
  auth: { uid: 'student-1', token: { platformAdmin: false } },
  data
}) as never;

describe('Phase 5 knowledge search pagination', () => {
  beforeEach(() => {
    state.calls = [];
    state.docs = [];
  });

  it('applies every question filter before the cursor so page two does not throw', async () => {
    // A non-null cursor is the whole point: with `before: undefined` the broken
    // ordering never surfaced.
    await expect(searchQuestions(request({ query: 'drivetrain', before: '1750000000000' }))).resolves.toMatchObject({ questions: [] });
    const startAfterIndex = state.calls.indexOf('startAfter');
    expect(startAfterIndex).toBeGreaterThan(-1);
    expect(state.calls.slice(startAfterIndex)).not.toContain('where');
    expect(state.calls.slice(0, startAfterIndex)).toContain('where');
  });

  it('applies every video filter before the cursor so page two does not throw', async () => {
    await expect(searchVideos(request({ query: 'drivetrain', before: '1750000000000' }))).resolves.toMatchObject({ videos: [] });
    const startAfterIndex = state.calls.indexOf('startAfter');
    expect(startAfterIndex).toBeGreaterThan(-1);
    expect(state.calls.slice(startAfterIndex)).not.toContain('where');
    expect(state.calls.slice(0, startAfterIndex)).toContain('where');
  });

  it('omits the cursor entirely on the first page', async () => {
    await searchQuestions(request({ query: 'drivetrain' }));
    expect(state.calls).not.toContain('startAfter');
  });

  it('rejects a malformed cursor rather than silently restarting at page one', async () => {
    await expect(searchQuestions(request({ query: 'drivetrain', before: 'not-a-number' }))).rejects.toThrow(/Search cursor is invalid/);
    await expect(searchQuestions(request({ query: 'drivetrain', before: -1 }))).rejects.toThrow(/Search cursor is invalid/);
    await expect(searchVideos(request({ query: 'drivetrain', before: 'not-a-number' }))).rejects.toThrow(/Search cursor is invalid/);
  });
});
