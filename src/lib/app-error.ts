/**
 * An error that carries a Firebase-style `code`.
 *
 * `getRequestState` in `request-state.ts` classifies failures by their `code` to
 * choose between the permission-denied, offline, and generic error panels. A
 * bare `new Error('…not found')` has no code, so it always fell through to the
 * generic "Request failed" panel even when the real cause was a permission
 * denial. Services throw this instead so the shared classifier keeps working.
 */
export type AppErrorCode =
  | 'not-found'
  | 'permission-denied'
  | 'invalid-argument'
  | 'unavailable'
  | 'failed-precondition';

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
