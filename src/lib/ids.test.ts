import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationId } from './ids';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createOperationId', () => {
  it('returns a bare id when no prefix is given and prefixes it when one is', () => {
    expect(createOperationId()).not.toContain('undefined');
    expect(createOperationId('poll')).toMatch(/^poll-/);
  });

  it('stays unique across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createOperationId('op')));
    expect(ids.size).toBe(200);
  });

  it('stays unique in the fallback path, where these ids are the idempotency keys', () => {
    // Freeze the clock so a Date.now()-only fallback would collide.
    vi.stubGlobal('crypto', {});
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const ids = new Set(Array.from({ length: 200 }, () => createOperationId('op')));
    expect(ids.size).toBe(200);

    vi.mocked(Date.now).mockRestore();
  });
});
