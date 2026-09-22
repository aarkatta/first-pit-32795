import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

afterEach(() => Reflect.deleteProperty(navigator, 'clipboard'));

function withClipboard(writeText: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('copyToClipboard', () => {
  it('reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    withClipboard(writeText);
    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('reports failure instead of throwing when the API is missing or refused', async () => {
    await expect(copyToClipboard('hello')).resolves.toBe(false);
    withClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });
});
