/**
 * Operation and resource IDs double as the server-side idempotency keys for every
 * mutation (`kanbanOperations`, `phase3Operations`, `phase6Operations`), so two
 * calls must never produce the same value. `crypto.randomUUID` covers every
 * supported browser; the fallback adds a random suffix because a bare
 * `Date.now()` collides for two mutations issued in the same millisecond.
 */
export function createOperationId(prefix?: string): string {
  const value =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prefix ? `${prefix}-${value}` : value;
}
